import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import {
  LIVE_EVENT,
  eventDayNotFound,
  liveEventDay,
} from "@/lib/event-scope";
import { formatDateOnly } from "@/lib/attendance";

// Schedule templates (item 7), without a template table.
//
// What the operation repeats is not an abstract "Tuesday template" but last
// Tuesday: the same arrival, snack, activity block and pickup, with the one
// activity swapped. So the template is any past day that has a schedule, and
// "use a template" is copying its slots into this day. A saved-template table
// would be a second copy of the same thing that drifts from what the team
// actually ran; this way the newest good day is always the template.

const CANDIDATES = 25;

// GET /api/event-days/:id/activity-slots/copy — days this one can copy from:
// the most recent days (of any live event) that have a schedule, same weekday
// first, because a Friday is copied from a Friday.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("schedule:edit");
  if (response) return response;

  try {
    const target = await prisma.eventDay.findFirst({
      where: liveEventDay(params.id),
      select: { id: true, date: true },
    });
    if (!target) return eventDayNotFound();

    const days = await prisma.eventDay.findMany({
      where: {
        id: { not: target.id },
        event: LIVE_EVENT,
        activitySlots: { some: { status: "approved" } },
      },
      orderBy: { date: "desc" },
      take: CANDIDATES * 2,
      select: {
        id: true,
        date: true,
        event: { select: { name: true } },
        activitySlots: {
          where: { status: "approved" },
          orderBy: [{ order: "asc" }, { startTime: "asc" }],
          select: { startTime: true, title: true },
        },
      },
    });

    const weekday = target.date.getUTCDay();
    const sorted = [...days]
      .sort(
        (a, b) =>
          Number(b.date.getUTCDay() === weekday) - Number(a.date.getUTCDay() === weekday) ||
          b.date.getTime() - a.date.getTime(),
      )
      .slice(0, CANDIDATES);

    return NextResponse.json(
      sorted.map((d) => ({
        id: d.id,
        date: formatDateOnly(d.date),
        eventName: d.event.name,
        slots: d.activitySlots.map((s) => ({ startTime: s.startTime, title: s.title })),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/event-days/:id/activity-slots/copy — Body: { fromDayId }
//
// Appends the source day's approved slots after whatever this day already has.
// Only approved slots: a proposal nobody signed off, or one sent back for a
// fix, was not part of that day and should not become part of this one.
//
// Guarded on schedule:edit, and the copies land approved — an adult choosing
// "do what we did last Tuesday" is approving it by choosing it, the same way
// an adult's own new slot is. A youth counselor proposes one slot at a time.
//
// A group or bank activity that has since been deleted/archived is dropped
// from the copy (the slot stays, as "the whole event" / not from the bank)
// rather than failing the whole copy or resurrecting it.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("schedule:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const fromDayId = typeof body?.fromDayId === "string" ? body.fromDayId : "";
    if (!fromDayId || fromDayId === params.id) {
      return NextResponse.json({ error: "יש לבחור יום אחר להעתקה" }, { status: 400 });
    }

    const [target, source] = await Promise.all([
      prisma.eventDay.findFirst({ where: liveEventDay(params.id), select: { id: true } }),
      prisma.eventDay.findFirst({
        where: liveEventDay(fromDayId),
        select: {
          activitySlots: {
            where: { status: "approved" },
            orderBy: [{ order: "asc" }, { startTime: "asc" }],
            select: {
              startTime: true,
              endTime: true,
              title: true,
              location: true,
              notes: true,
              group: { select: { id: true, deletedAt: true } },
              activity: { select: { id: true, deletedAt: true } },
            },
          },
        },
      }),
    ]);
    if (!target || !source) return eventDayNotFound();
    if (source.activitySlots.length === 0) {
      return NextResponse.json({ error: "אין ביום הזה לוז להעתקה" }, { status: 400 });
    }

    const isLive = (row: { deletedAt: Date | null } | null) => !!row && row.deletedAt === null;

    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.activitySlot.findFirst({
        where: { eventDayId: target.id },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      const base = (last?.order ?? -1) + 1;
      const out = [];
      for (const [i, s] of source.activitySlots.entries()) {
        out.push(
          await tx.activitySlot.create({
            data: {
              eventDayId: target.id,
              startTime: s.startTime,
              endTime: s.endTime,
              title: s.title,
              location: s.location,
              notes: s.notes,
              groupId: isLive(s.group) ? s.group!.id : null,
              activityId: isLive(s.activity) ? s.activity!.id : null,
              order: base + i,
            },
            include: {
              group: { select: { id: true, name: true } },
              activity: { select: { id: true, name: true } },
            },
          }),
        );
      }
      return out;
    });

    return NextResponse.json({ created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
