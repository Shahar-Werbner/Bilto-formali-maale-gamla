import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { generateParentToken } from "@/lib/parents";

// Issuing and revoking the personal links families use (item 5).
//
// `parent:link` rather than `roster:edit`: a link is a URL that writes into one
// child's record with no sign-in behind it. Handing one out is closer to
// handing out a key than to correcting a spelling, so it is an adult's act —
// see the note in src/lib/roles.ts.

const LABEL_MAX = 40;

// GET /api/parent-links?participantId=... — the links a child has, for the
// roster screen: which exist, whether anyone has ever opened them, and which
// were turned off.
export async function GET(request: Request) {
  const { response } = await requireCapability("parent:link");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const participantId = searchParams.get("participantId") ?? "";
    if (!participantId) {
      return NextResponse.json({ error: "חסר מזהה ילד/ה" }, { status: 400 });
    }

    // A soft-deleted child is gone from every screen, this one included.
    const child = await prisma.participant.findFirst({
      where: { id: participantId, deletedAt: null },
      select: { id: true },
    });
    if (!child) {
      return NextResponse.json({ error: "ילד/ה לא נמצא/ה" }, { status: 404 });
    }

    const links = await prisma.parentLink.findMany({
      where: { participantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        token: true,
        label: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      links: links.map((l) => ({
        ...l,
        revokedAt: l.revokedAt?.toISOString() ?? null,
        lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/parent-links — mint a link for one child.
// Body: { participantId, label? }
//
// A child may have more than one, and that is the point rather than an
// oversight: separated parents each need their own, and two links are what
// makes it possible to turn one off without cutting off the other.
export async function POST(request: Request) {
  const { response } = await requireCapability("parent:link");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const participantId =
      typeof body?.participantId === "string" ? body.participantId : "";
    const label =
      typeof body?.label === "string" ? body.label.trim().slice(0, LABEL_MAX) : "";

    if (!participantId) {
      return NextResponse.json({ error: "חסר מזהה ילד/ה" }, { status: 400 });
    }

    const child = await prisma.participant.findFirst({
      where: { id: participantId, deletedAt: null },
      select: { id: true },
    });
    if (!child) {
      return NextResponse.json({ error: "ילד/ה לא נמצא/ה" }, { status: 404 });
    }

    const link = await prisma.parentLink.create({
      data: { participantId, token: generateParentToken(), label: label || null },
      select: { id: true, token: true, label: true, createdAt: true },
    });

    return NextResponse.json(
      { ...link, createdAt: link.createdAt.toISOString() },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/parent-links?id=... — turn a link off.
//
// Revoked, not deleted. The row is what keeps the token from being handed out
// again, and "this link was turned off on the 3rd" is something an adult may
// need to be able to see later — which a deleted row cannot say.
export async function DELETE(request: Request) {
  const { response } = await requireCapability("parent:link");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id") ?? "";
    if (!id) {
      return NextResponse.json({ error: "חסר מזהה קישור" }, { status: 400 });
    }

    const revoked = await prisma.parentLink.updateMany({
      where: { id, revokedAt: null, participant: { deletedAt: null } },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      return NextResponse.json({ error: "הקישור לא נמצא" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
