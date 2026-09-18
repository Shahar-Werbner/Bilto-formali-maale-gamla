import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveActivitySlotsOfDay } from "@/lib/event-scope";

// POST /api/event-days/:id/activity-slots/reorder — persist a new slot order.
// Body: { orderedIds: string[] }  → order = index.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const orderedIds: string[] = Array.isArray(body?.orderedIds)
      ? body.orderedIds.filter((x: unknown) => typeof x === "string")
      : [];
    if (orderedIds.length === 0) {
      return NextResponse.json({ error: "רשימה ריקה" }, { status: 400 });
    }

    // The ids come from the client, so make sure they are this day's slots
    // before writing — otherwise a stale or crafted request could reshuffle
    // another day's schedule.
    const owned = await prisma.activitySlot.findMany({
      where: { ...liveActivitySlotsOfDay(params.id), id: { in: orderedIds } },
      select: { id: true },
    });
    if (owned.length !== orderedIds.length) {
      return NextResponse.json(
        { error: "חלק מהפעילויות אינן שייכות ליום זה" },
        { status: 400 },
      );
    }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.activitySlot.update({ where: { id }, data: { order: index } }),
      ),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
