import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { formatDateOnly, parseDateOnly } from "@/lib/attendance";
import { generateEventDates } from "@/lib/events";

// PATCH /api/events/:id — rename an event and/or change its date range.
// Body: { name?, startDate?, endDate?, includeFriday?, includeSaturday? }
//
// Changing the range re-generates the event's days additively: missing days are
// created, and days that fall outside the new range are removed only when they
// hold nothing (no attendance, no schedule). A day someone already worked on is
// never deleted behind their back — the response reports how many were kept.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const event = await prisma.event.findUnique({
      where: { id: params.id },
      include: {
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
    const includeFriday =
      body?.includeFriday === undefined
        ? event.includeFriday
        : body.includeFriday === true;
    const includeSaturday =
      body?.includeSaturday === undefined
        ? event.includeSaturday
        : body.includeSaturday === true;

    const start = parseDateOnly(startStr);
    const end = parseDateOnly(endStr);
    if (!start || !end) {
      return NextResponse.json({ error: "תאריך לא תקין" }, { status: 400 });
    }
    if (start.getTime() > end.getTime()) {
      return NextResponse.json(
        { error: "תאריך ההתחלה מאוחר מתאריך הסיום" },
        { status: 400 },
      );
    }

    const wanted = generateEventDates(
      startStr,
      endStr,
      includeFriday,
      includeSaturday,
    );
    if (wanted.length === 0) {
      return NextResponse.json({ error: "אין ימים בטווח שנבחר" }, { status: 400 });
    }

    const existing = new Map(event.days.map((d) => [formatDateOnly(d.date), d]));
    const toCreate = wanted.filter((d) => !existing.has(d));
    const obsolete = event.days.filter(
      (d) => !wanted.includes(formatDateOnly(d.date)),
    );
    const removable = obsolete.filter(
      (d) => d._count.attendance === 0 && d._count.activitySlots === 0,
    );
    const kept = obsolete.length - removable.length;

    await prisma.$transaction([
      prisma.event.update({
        where: { id: event.id },
        data: {
          name,
          startDate: start,
          endDate: end,
          includeFriday,
          includeSaturday,
        },
      }),
      ...(removable.length
        ? [
            prisma.eventDay.deleteMany({
              where: { id: { in: removable.map((d) => d.id) } },
            }),
          ]
        : []),
      ...toCreate.map((d) =>
        prisma.eventDay.create({
          data: { eventId: event.id, date: parseDateOnly(d)! },
        }),
      ),
    ]);

    return NextResponse.json({
      ok: true,
      added: toCreate.length,
      removed: removable.length,
      keptWithData: kept,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/events/:id — removes the event, its days and their attendance
// (cascade). The event's participants themselves are not deleted.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    await prisma.event.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
