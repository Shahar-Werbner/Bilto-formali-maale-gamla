import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, sessionCan } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import {
  liveActivity,
  liveActivitySlotsOfDay,
  liveGroup,
  liveEventDay,
} from "@/lib/event-scope";
import { statusForNewSlot } from "@/lib/schedule";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanTime(v: unknown): string | null {
  return typeof v === "string" && TIME.test(v.trim()) ? v.trim() : null;
}
function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// GET /api/event-days/:id/activity-slots — the day's schedule, ordered.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("schedule:view");
  if (response) return response;

  try {
    // Scoped like every other read: a day's id says nothing about whether its
    // event was deleted, and this used to answer with the schedule anyway.
    const slots = await prisma.activitySlot.findMany({
      where: liveActivitySlotsOfDay(params.id),
      orderBy: [{ order: "asc" }, { startTime: "asc" }],
      include: {
        group: { select: { id: true, name: true } },
        activity: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(slots);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/event-days/:id/activity-slots — add a schedule slot.
// Body: { startTime, endTime?, title, location?, groupId?, notes?, activityId? }
// `activityId` = picked from the bank (item 7); the slot still carries its own
// title and notes, so the bank entry can change later without rewriting it.
//
// Guarded on the narrower capability, `schedule:propose`: a youth counselor
// plans the activity they run. What `schedule:edit` changes is not whether the
// write is allowed but what it lands as — part of the day, or waiting for an
// adult. One route, because the two differ by one field.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("schedule:propose");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const startTime = cleanTime(body?.startTime);
    const title = cleanStr(body?.title);
    if (!startTime || !title) {
      return NextResponse.json(
        { error: "יש למלא שעת התחלה וכותרת" },
        { status: 400 },
      );
    }

    const day = await prisma.eventDay.findFirst({
      where: liveEventDay(params.id),
      select: { id: true },
    });
    if (!day) {
      return NextResponse.json({ error: "יום לא נמצא" }, { status: 404 });
    }

    const groupId = cleanStr(body?.groupId);
    if (
      groupId &&
      !(await prisma.group.findFirst({ where: liveGroup(groupId) }))
    ) {
      return NextResponse.json({ error: "קבוצה לא נמצאה" }, { status: 400 });
    }

    const activityId = cleanStr(body?.activityId);
    if (
      activityId &&
      !(await prisma.activity.findFirst({ where: liveActivity(activityId) }))
    ) {
      return NextResponse.json({ error: "הפעילות לא נמצאה במאגר" }, { status: 400 });
    }

    const canEdit = await sessionCan("schedule:edit");

    const last = await prisma.activitySlot.findFirst({
      where: { eventDayId: params.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const slot = await prisma.activitySlot.create({
      data: {
        eventDayId: params.id,
        startTime,
        endTime: cleanTime(body?.endTime),
        title,
        location: cleanStr(body?.location),
        groupId,
        notes: cleanStr(body?.notes),
        activityId,
        order: (last?.order ?? -1) + 1,
        status: statusForNewSlot(canEdit),
      },
      include: {
        group: { select: { id: true, name: true } },
        activity: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(slot, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
