import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { isStatus, parseDateOnly } from "@/lib/attendance";

// POST /api/attendance/bulk — set the same status for every participant in a
// group on a given day (powers the "mark whole group present" button).
// Body: { groupId, date: "YYYY-MM-DD", status }
export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";
  const status = body?.status;
  const date = parseDateOnly(typeof body?.date === "string" ? body.date : "");

  if (!groupId || !date || !isStatus(status)) {
    return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
  }

  const participants = await prisma.participant.findMany({
    where: { groupId },
    select: { id: true },
  });

  await prisma.$transaction(
    participants.map((p) =>
      prisma.attendanceRecord.upsert({
        where: { date_participantId: { date, participantId: p.id } },
        update: { status, markedByUserId: session.user.id },
        create: {
          date,
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
