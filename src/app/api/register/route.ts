import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

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
  if (password.length < 6) {
    return NextResponse.json(
      { error: "הסיסמה חייבת להכיל לפחות 6 תווים" },
      { status: 400 },
    );
  }
  if (code !== signupCode) {
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
}
