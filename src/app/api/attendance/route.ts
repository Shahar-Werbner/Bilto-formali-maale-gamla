import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { isStatus, parseDateOnly, formatDateOnly } from "@/lib/attendance";

// GET /api/attendance?date=YYYY-MM-DD — all records for a given day, keyed by
// participant so the client can render current statuses.
export async function GET(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get("date") ?? "";
  const date = parseDateOnly(dateStr);
  if (!date) {
    return NextResponse.json({ error: "תאריך לא תקין" }, { status: 400 });
  }

  const records = await prisma.attendanceRecord.findMany({
    where: { date },
    select: { participantId: true, status: true },
  });

  const byParticipant: Record<string, string> = {};
  for (const r of records) byParticipant[r.participantId] = r.status;

  return NextResponse.json({ date: formatDateOnly(date), byParticipant });
}

// POST /api/attendance — upsert a single participant's status for a day.
// Body: { participantId, date: "YYYY-MM-DD", status }
export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const participantId =
    typeof body?.participantId === "string" ? body.participantId : "";
  const status = body?.status;
  const date = parseDateOnly(typeof body?.date === "string" ? body.date : "");

  if (!participantId || !date || !isStatus(status)) {
    return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
  }

  const record = await prisma.attendanceRecord.upsert({
    where: { date_participantId: { date, participantId } },
    update: { status, markedByUserId: session.user.id },
    create: {
      date,
      participantId,
      status,
      markedByUserId: session.user.id,
    },
  });

  return NextResponse.json({
    participantId: record.participantId,
    status: record.status,
  });
}
