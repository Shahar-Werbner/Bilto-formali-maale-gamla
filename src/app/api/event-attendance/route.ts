import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { isStatus } from "@/lib/attendance";

// GET /api/event-attendance?eventDayId=... — statuses for a day, by participant.
export async function GET(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const eventDayId = searchParams.get("eventDayId") ?? "";
  if (!eventDayId) {
    return NextResponse.json({ error: "חסר מזהה יום" }, { status: 400 });
  }

  const records = await prisma.eventAttendance.findMany({
    where: { eventDayId },
    select: { participantId: true, status: true },
  });

  const byParticipant: Record<string, string> = {};
  for (const r of records) byParticipant[r.participantId] = r.status;
  return NextResponse.json({ byParticipant });
}

// POST /api/event-attendance — upsert one participant's status for a day.
// Body: { eventDayId, participantId, status }
export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const eventDayId = typeof body?.eventDayId === "string" ? body.eventDayId : "";
  const participantId =
    typeof body?.participantId === "string" ? body.participantId : "";
  const status = body?.status;

  if (!eventDayId || !participantId || !isStatus(status)) {
    return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
  }

  const record = await prisma.eventAttendance.upsert({
    where: { eventDayId_participantId: { eventDayId, participantId } },
    update: { status, markedByUserId: session.user.id },
    create: { eventDayId, participantId, status, markedByUserId: session.user.id },
  });

  return NextResponse.json({
    participantId: record.participantId,
    status: record.status,
  });
}
