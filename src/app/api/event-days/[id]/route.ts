import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { eventDayNotFound, liveEventDay } from "@/lib/event-scope";

// PATCH /api/event-days/:id — update the activity description for a day.
// Body: { description }  ("" clears it)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("schedule:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.description !== "string") {
      return NextResponse.json({ error: "תיאור חסר" }, { status: 400 });
    }
    const description = body.description.trim() || null;

    const updated = await prisma.eventDay.updateMany({
      where: liveEventDay(params.id),
      data: { description },
    });
    if (updated.count === 0) return eventDayNotFound();
    return NextResponse.json({ id: params.id, description });
  } catch (err) {
    return handleApiError(err);
  }
}
