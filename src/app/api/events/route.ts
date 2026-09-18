import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { parseDateOnly } from "@/lib/attendance";
import { generateEventDays } from "@/lib/events";
import { parseScheduleInput, validateRange } from "@/lib/event-input";

// GET /api/events — all events (newest first) with day + participant counts.
export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const events = await prisma.event.findMany({
      where: { deletedAt: null },
      orderBy: { startDate: "desc" },
      include: {
        weekdays: { orderBy: { weekday: "asc" } },
        _count: { select: { days: true, participants: true } },
      },
    });
    return NextResponse.json(events);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/events — create an event, generate its days, connect participants.
// Body: { name, startDate, endDate, kind, participantIds[],
//         camp:      includeFriday, includeSaturday, defaultStartTime, defaultEndTime
//         recurring: weekdays: [{ weekday, startTime, endTime }] }
export async function POST(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";
    const participantIds: string[] = Array.isArray(body?.participantIds)
      ? body.participantIds.filter((x: unknown) => typeof x === "string")
      : [];

    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (!name || !start || !end) {
      return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
    }

    const range = validateRange(startDate, endDate);
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: range.status });
    }

    // A new event with nothing sent is the old camp shape, unchanged.
    const schedule = parseScheduleInput(body, {
      kind: "camp",
      includeFriday: false,
      includeSaturday: false,
      defaultStartTime: null,
      defaultEndTime: null,
      weekdays: [],
    });
    if (!schedule.ok) {
      return NextResponse.json({ error: schedule.error }, { status: 400 });
    }

    const days = generateEventDays({ startDate, endDate, ...schedule.value });
    if (days.length === 0) {
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
        kind: schedule.value.kind,
        includeFriday: schedule.value.includeFriday,
        includeSaturday: schedule.value.includeSaturday,
        defaultStartTime: schedule.value.defaultStartTime,
        defaultEndTime: schedule.value.defaultEndTime,
        weekdays: schedule.value.weekdays.length
          ? { create: schedule.value.weekdays }
          : undefined,
        participants: participantIds.length
          ? { connect: participantIds.map((id) => ({ id })) }
          : undefined,
        days: {
          create: days.map((d) => ({
            date: parseDateOnly(d.date)!,
            startTime: d.startTime,
            endTime: d.endTime,
          })),
        },
      },
      include: { _count: { select: { days: true, participants: true } } },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
