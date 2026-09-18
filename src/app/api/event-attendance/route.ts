import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { isStatus } from "@/lib/attendance";

// GET /api/event-attendance?eventDayId=... — statuses for a day, by participant.
export async function GET(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  try {
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
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/event-attendance — upsert one participant's status for a day.
// Body: { eventDayId, participantId, status }
export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const eventDayId = typeof body?.eventDayId === "string" ? body.eventDayId : "";
    const participantId =
      typeof body?.participantId === "string" ? body.participantId : "";
    const status = body?.status;

    if (!eventDayId || !participantId || !isStatus(status)) {
      return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
    }

    // Only children who are actually on the event may be marked; anything else
    // would create attendance that no screen or export ever shows.
    const day = await prisma.eventDay.findFirst({
      where: {
        id: eventDayId,
        event: {
          deletedAt: null,
          participants: { some: { id: participantId, deletedAt: null } },
        },
      },
      select: { id: true },
    });
    if (!day) {
      return NextResponse.json(
        { error: "המשתתף אינו רשום לאירוע זה" },
        { status: 404 },
      );
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
  } catch (err) {
    return handleApiError(err);
  }
}
