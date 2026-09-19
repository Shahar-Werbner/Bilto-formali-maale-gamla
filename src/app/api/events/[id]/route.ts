import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { formatDateOnly, parseDateOnly } from "@/lib/attendance";
import { generateEventDays, isEventKind, type GeneratedDay } from "@/lib/events";
import { parseScheduleInput, validateRange } from "@/lib/event-input";

// PATCH /api/events/:id — rename an event, change its date range, or change
// its schedule (camp hours, or the weekday pattern of a recurring event).
// Body: { name?, startDate?, endDate?, kind?, includeFriday?, includeSaturday?,
//         defaultStartTime?, defaultEndTime?, weekdays? }
//
// Changing the schedule re-generates the event's days additively: missing days
// are created, and days that fall outside the new pattern are removed only when
// they hold nothing (no attendance, no schedule). A day someone already worked
// on is never deleted behind their back — the response reports how many were
// kept.
//
// Hours on days that survive are refreshed from the new template, but only when
// they still match the *old* template. A day whose hours were set to something
// else was edited on purpose, and a template change must not silently undo it.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("event:edit");
  if (response) return response;

  try {
    const event = await prisma.event.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        weekdays: { orderBy: { weekday: "asc" } },
        days: {
          orderBy: { date: "asc" },
          include: { _count: { select: { attendance: true, activitySlots: true } } },
        },
      },
    });
    if (!event) {
      return NextResponse.json({ error: "אירוע לא נמצא" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);

    let name = event.name;
    if (body?.name !== undefined) {
      const v = typeof body.name === "string" ? body.name.trim() : "";
      if (!v) {
        return NextResponse.json({ error: "שם האירוע חסר" }, { status: 400 });
      }
      name = v;
    }

    const startStr =
      typeof body?.startDate === "string"
        ? body.startDate
        : formatDateOnly(event.startDate);
    const endStr =
      typeof body?.endDate === "string"
        ? body.endDate
        : formatDateOnly(event.endDate);

    const start = parseDateOnly(startStr);
    const end = parseDateOnly(endStr);
    if (!start || !end) {
      return NextResponse.json({ error: "תאריך לא תקין" }, { status: 400 });
    }
    const range = validateRange(startStr, endStr);
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: range.status });
    }

    const previous = {
      kind: isEventKind(event.kind) ? event.kind : ("camp" as const),
      includeFriday: event.includeFriday,
      includeSaturday: event.includeSaturday,
      defaultStartTime: event.defaultStartTime,
      defaultEndTime: event.defaultEndTime,
      weekdays: event.weekdays.map((w) => ({
        weekday: w.weekday,
        startTime: w.startTime,
        endTime: w.endTime,
      })),
    };

    const schedule = parseScheduleInput(body, previous);
    if (!schedule.ok) {
      return NextResponse.json({ error: schedule.error }, { status: 400 });
    }

    const wanted = generateEventDays({
      startDate: startStr,
      endDate: endStr,
      ...schedule.value,
    });
    if (wanted.length === 0) {
      return NextResponse.json({ error: "אין ימים בטווח שנבחר" }, { status: 400 });
    }

    // What the old template *would* have produced for the same range, so we can
    // tell an untouched day from one somebody edited by hand.
    const before = new Map<string, GeneratedDay>(
      generateEventDays({
        startDate: formatDateOnly(event.startDate),
        endDate: formatDateOnly(event.endDate),
        ...previous,
      }).map((d) => [d.date, d]),
    );

    const wantedByDate = new Map(wanted.map((d) => [d.date, d]));
    const existing = new Map(event.days.map((d) => [formatDateOnly(d.date), d]));

    const toCreate = wanted.filter((d) => !existing.has(d.date));
    const obsolete = event.days.filter(
      (d) => !wantedByDate.has(formatDateOnly(d.date)),
    );
    const removable = obsolete.filter(
      (d) => d._count.attendance === 0 && d._count.activitySlots === 0,
    );
    const kept = obsolete.length - removable.length;

    const toRetime = event.days.filter((day) => {
      const date = formatDateOnly(day.date);
      const target = wantedByDate.get(date);
      if (!target) return false;
      if (day.startTime === target.startTime && day.endTime === target.endTime) {
        return false;
      }
      const old = before.get(date);
      const untouched =
        day.startTime === (old?.startTime ?? null) &&
        day.endTime === (old?.endTime ?? null);
      return untouched;
    });

    await prisma.$transaction([
      prisma.event.update({
        where: { id: event.id },
        data: {
          name,
          startDate: start,
          endDate: end,
          kind: schedule.value.kind,
          includeFriday: schedule.value.includeFriday,
          includeSaturday: schedule.value.includeSaturday,
          defaultStartTime: schedule.value.defaultStartTime,
          defaultEndTime: schedule.value.defaultEndTime,
        },
      }),
      // The weekday template is small and fully replaced, so wiping and
      // re-creating it inside the transaction is simpler than diffing rows.
      prisma.eventWeekday.deleteMany({ where: { eventId: event.id } }),
      ...(schedule.value.weekdays.length
        ? [
            prisma.eventWeekday.createMany({
              data: schedule.value.weekdays.map((w) => ({ ...w, eventId: event.id })),
            }),
          ]
        : []),
      ...(removable.length
        ? [
            prisma.eventDay.deleteMany({
              where: { id: { in: removable.map((d) => d.id) } },
            }),
          ]
        : []),
      ...toRetime.map((day) => {
        const target = wantedByDate.get(formatDateOnly(day.date))!;
        return prisma.eventDay.update({
          where: { id: day.id },
          data: { startTime: target.startTime, endTime: target.endTime },
        });
      }),
      ...toCreate.map((d) =>
        prisma.eventDay.create({
          data: {
            eventId: event.id,
            date: parseDateOnly(d.date)!,
            startTime: d.startTime,
            endTime: d.endTime,
          },
        }),
      ),
    ]);

    return NextResponse.json({
      ok: true,
      added: toCreate.length,
      removed: removable.length,
      keptWithData: kept,
      retimed: toRetime.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/events/:id — soft delete: the event disappears from every screen
// but its days and attendance survive, and an admin can restore it from /admin.
// Admin only — an event holds the attendance history of every child on it.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    await prisma.event.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
