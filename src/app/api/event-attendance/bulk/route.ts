import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { isStatus } from "@/lib/attendance";

// POST /api/event-attendance/bulk — set the same status for every participant
// of the event on a given day. Body: { eventDayId, status }
export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const eventDayId = typeof body?.eventDayId === "string" ? body.eventDayId : "";
  const status = body?.status;

  if (!eventDayId || !isStatus(status)) {
    return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
  }

  // The event's participants (via the day → event → participants relation).
  const day = await prisma.eventDay.findUnique({
    where: { id: eventDayId },
    include: { event: { include: { participants: { select: { id: true } } } } },
  });
  if (!day) {
    return NextResponse.json({ error: "יום לא נמצא" }, { status: 404 });
  }
  const participants = day.event.participants;

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
}
