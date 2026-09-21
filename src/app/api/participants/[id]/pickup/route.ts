import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, sessionCapabilities } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { isDismissalMethod } from "@/lib/dismissal";
import { normalizePhone } from "@/lib/participants";

// Who may collect one child, and the standing instruction for how they go home.
//
// The two live on one route because they are one question — "what happens to
// this child at the end of the day" — and the screen that asks it asks both at
// once. Everything here is scoped to a live child: an authorization on a
// soft-deleted record must not be reachable, and a restored child must come
// back with exactly the list they were deleted with.

const liveParticipant = (id: string) => ({ id, deletedAt: null });

async function participantExists(id: string): Promise<boolean> {
  const found = await prisma.participant.findFirst({
    where: liveParticipant(id),
    select: { id: true },
  });
  return Boolean(found);
}

function notFound() {
  return NextResponse.json({ error: "ילד/ה לא נמצא/ה" }, { status: 404 });
}

// GET — the standing instruction and the pickup list.
//
// Readable by anyone who works the dismissal screen, youth counselors
// included: knowing who is on the list is the whole point of the check they
// are asked to make at the gate. The phone number is not part of that check,
// so it is left out of the query for anyone without roster:contacts — a field
// that is never selected cannot leak (invariant: contacts are enforced at the
// field, not at the screen).
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("dismissal:view");
  if (response) return response;

  try {
    const capabilities = await sessionCapabilities();
    const withPhones = capabilities.includes("roster:contacts");

    const participant = await prisma.participant.findFirst({
      where: liveParticipant(params.id),
      select: { id: true, defaultDismissal: true },
    });
    if (!participant) return notFound();

    const authorizations = await prisma.pickupAuthorization.findMany({
      where: { participantId: params.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        relation: true,
        phone: withPhones,
      },
    });

    return NextResponse.json({
      defaultDismissal: participant.defaultDismissal,
      authorizations,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// PATCH — change the standing instruction. Body: { defaultDismissal }
//
// Adults only. "This child walks home by themselves" is a decision about a
// six-year-old, not a preference, and it is the one setting that makes every
// later dismissal routine instead of an exception.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("dismissal:authorize");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    if (!isDismissalMethod(body?.defaultDismissal)) {
      return NextResponse.json(
        { error: "הוראת שחרור לא תקינה" },
        { status: 400 },
      );
    }

    const updated = await prisma.participant.updateMany({
      where: liveParticipant(params.id),
      data: { defaultDismissal: body.defaultDismissal },
    });
    if (updated.count === 0) return notFound();

    return NextResponse.json({ defaultDismissal: body.defaultDismissal });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST — add someone to the pickup list. Body: { name, phone?, relation? }
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("dismissal:authorize");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "חסר שם" }, { status: 400 });
    }

    if (!(await participantExists(params.id))) return notFound();

    // Normalised on write like every other phone in the system, so a number
    // typed here dials the same way one that arrived through the importer does.
    const phone =
      typeof body?.phone === "string" && body.phone.trim()
        ? normalizePhone(body.phone)
        : null;
    const relation =
      typeof body?.relation === "string" ? body.relation.trim() || null : null;

    const created = await prisma.pickupAuthorization.create({
      data: { participantId: params.id, name, phone, relation },
      select: { id: true, name: true, relation: true, phone: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/participants/:id/pickup?authorizationId=... — take someone off.
//
// Deleted for real rather than soft-deleted: unlike a child or an event, this
// row is not a record of something that happened. The record of who actually
// collected a child is Dismissal.pickedUpByName, which is a copy of the name
// at the time and survives this.
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("dismissal:authorize");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const authorizationId = searchParams.get("authorizationId") ?? "";
    if (!authorizationId) {
      return NextResponse.json({ error: "חסר מזהה" }, { status: 400 });
    }

    if (!(await participantExists(params.id))) return notFound();

    // Scoped by participant as well as by id: an id from another child's list
    // must not delete through this path.
    const deleted = await prisma.pickupAuthorization.deleteMany({
      where: { id: authorizationId, participantId: params.id },
    });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "הרשאה לא נמצאה" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
