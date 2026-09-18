import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-error";

// This is the one unauthenticated write in the app, guarded by a single shared
// code. Without a throttle the code is guessable at request speed, so cap how
// many attempts an IP may make. The map is per serverless instance — good
// enough to make scripted guessing impractical, not a security boundary on its
// own; the code itself should still be long.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

function codeMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length — compare fixed-size digests of equal length instead.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// POST /api/register — self-service staff signup, gated by a shared team code.
// Body: { name, email, password, code }
// Requires env SIGNUP_CODE to be set; if unset, registration is disabled.
export async function POST(request: Request) {
  const signupCode = process.env.SIGNUP_CODE;
  if (!signupCode) {
    return NextResponse.json(
      { error: "ההרשמה אינה פעילה כרגע" },
      { status: 503 },
    );
  }

  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (tooManyAttempts(ip)) {
      return NextResponse.json(
        { error: "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות." },
        { status: 429 },
      );
    }

    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "יש למלא שם, אימייל וסיסמה" },
        { status: 400 },
      );
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "אימייל לא תקין" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "הסיסמה חייבת להכיל לפחות 8 תווים" },
        { status: 400 },
      );
    }
    if (!codeMatches(code, signupCode)) {
      return NextResponse.json({ error: "קוד צוות שגוי" }, { status: 403 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "כתובת האימייל כבר רשומה" },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: { name, email, role: "staff", passwordHash },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
