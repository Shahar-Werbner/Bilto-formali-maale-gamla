import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { isStatus } from "@/lib/attendance";

// POST /api/event-attendance/bulk — set the same status for participants of the
// event on a given day. Body: { eventDayId, status, participantIds? }
// Without participantIds every participant of the event is marked.
export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const eventDayId = typeof body?.eventDayId === "string" ? body.eventDayId : "";
    const status = body?.status;
    const only: string[] | null = Array.isArray(body?.participantIds)
      ? body.participantIds.filter((x: unknown) => typeof x === "string")
      : null;

    if (!eventDayId || !isStatus(status)) {
      return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
    }

    // The event's participants (via the day → event → participants relation).
    const day = await prisma.eventDay.findUnique({
      where: { id: eventDayId },
      include: {
        event: {
          include: {
            participants: { where: { deletedAt: null }, select: { id: true } },
          },
        },
      },
    });
    if (!day) {
      return NextResponse.json({ error: "יום לא נמצא" }, { status: 404 });
    }
    const participants = only
      ? day.event.participants.filter((p) => only.includes(p.id))
      : day.event.participants;

    await prisma.$transaction(
      participants.map((p) =>
        prisma.eventAttendance.upsert({
          where: {
            eventDayId_participantId: { eventDayId, participantId: p.id },
          },
          update: { status, markedByUserId: session.user.id },
          create: {
            eventDayId,
            participantId: p.id,
            status,
            markedByUserId: session.user.id,
          },
        }),
      ),
    );

    const byParticipant: Record<string, string> = {};
    for (const p of participants) byParticipant[p.id] = status;
    return NextResponse.json({ byParticipant });
  } catch (err) {
    return handleApiError(err);
  }
}
