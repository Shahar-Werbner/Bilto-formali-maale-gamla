import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveEventDay } from "@/lib/event-scope";

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
  const { response } = await requireSession();
  if (response) return response;

  try {
    const slots = await prisma.activitySlot.findMany({
      where: { eventDayId: params.id },
      orderBy: [{ order: "asc" }, { startTime: "asc" }],
      include: { group: { select: { id: true, name: true } } },
    });
    return NextResponse.json(slots);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/event-days/:id/activity-slots — add a schedule slot.
// Body: { startTime, endTime?, title, location?, groupId?, notes? }
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
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
    if (groupId && !(await prisma.group.findUnique({ where: { id: groupId } }))) {
      return NextResponse.json({ error: "קבוצה לא נמצאה" }, { status: 400 });
    }

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
        order: (last?.order ?? -1) + 1,
      },
      include: { group: { select: { id: true, name: true } } },
    });
    return NextResponse.json(slot, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
