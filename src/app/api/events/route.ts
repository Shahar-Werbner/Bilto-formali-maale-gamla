import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { parseDateOnly } from "@/lib/attendance";
import { generateEventDates } from "@/lib/events";

// GET /api/events — all events (newest first) with day + participant counts.
export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { days: true, participants: true } },
    },
  });
  return NextResponse.json(events);
}

// POST /api/events — create an event, generate its days, connect participants.
// Body: { name, startDate, endDate, includeFriday, includeSaturday, participantIds[] }
export async function POST(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const endDate = typeof body?.endDate === "string" ? body.endDate : "";
  const includeFriday = body?.includeFriday === true;
  const includeSaturday = body?.includeSaturday === true;
  const participantIds: string[] = Array.isArray(body?.participantIds)
    ? body.participantIds.filter((x: unknown) => typeof x === "string")
    : [];

  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!name || !start || !end) {
    return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
  }
  if (start.getTime() > end.getTime()) {
    return NextResponse.json(
      { error: "תאריך ההתחלה מאוחר מתאריך הסיום" },
      { status: 400 },
    );
  }

  const dates = generateEventDates(
    startDate,
    endDate,
    includeFriday,
    includeSaturday,
  );
  if (dates.length === 0) {
    return NextResponse.json(
      { error: "אין ימים בטווח שנבחר" },
      { status: 400 },
    );
  }

  const event = await prisma.event.create({
    data: {
      name,
      startDate: start,
      endDate: end,
      includeFriday,
      includeSaturday,
      participants: participantIds.length
        ? { connect: participantIds.map((id) => ({ id })) }
        : undefined,
      days: {
        create: dates.map((d) => ({ date: parseDateOnly(d)! })),
      },
    },
    include: { _count: { select: { days: true, participants: true } } },
  });

  return NextResponse.json(event, { status: 201 });
}
