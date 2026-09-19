import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { eventNotFound, liveEvent } from "@/lib/event-scope";

// POST /api/events/:id/participants — add a child to an existing event.
// Body: { participantId }
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("event:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const participantId =
      typeof body?.participantId === "string" ? body.participantId : "";
    if (!participantId) {
      return NextResponse.json({ error: "חסר מזהה משתתף" }, { status: 400 });
    }

    const event = await prisma.event.findFirst({
      where: liveEvent(params.id),
      select: { id: true },
    });
    if (!event) return eventNotFound();

    await prisma.event.update({
      where: { id: params.id },
      data: { participants: { connect: { id: participantId } } },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/events/:id/participants?participantId=... — remove a child from
// the event (their attendance rows for this event are also removed).
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("event:edit");
  if (response) return response;

  try {
    const participantId =
      new URL(request.url).searchParams.get("participantId") ?? "";
    if (!participantId) {
      return NextResponse.json({ error: "חסר מזהה משתתף" }, { status: 400 });
    }

    const event = await prisma.event.findFirst({
      where: liveEvent(params.id),
      select: { id: true },
    });
    if (!event) return eventNotFound();

    // Both steps in one transaction: dropping the link but leaving orphan
    // attendance rows would skew the per-child report.
    await prisma.$transaction([
      prisma.eventAttendance.deleteMany({
        where: { participantId, eventDay: { eventId: params.id } },
      }),
      prisma.event.update({
        where: { id: params.id },
        data: { participants: { disconnect: { id: participantId } } },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
