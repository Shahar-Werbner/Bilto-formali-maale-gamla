import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveActivitySlot, slotNotFound } from "@/lib/event-scope";

// POST /api/activity-slots/:id/approve — an adult signs off a proposed slot,
// or sends it back for a fix. Body: { approve?: boolean } (default true).
//
// The three columns are written together on purpose: a slot that reads
// "approved" with no name and no time against it is a plan nobody can be asked
// about later. Sending one back clears them again, for the same reason.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { session, response } = await requireCapability("schedule:approve");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const approve = body?.approve !== false;

    // The slot's id says nothing about whether its event still exists.
    const owned = await prisma.activitySlot.findFirst({
      where: liveActivitySlot(params.id),
      select: { id: true },
    });
    if (!owned) return slotNotFound();

    const slot = await prisma.activitySlot.update({
      where: { id: params.id },
      data: approve
        ? {
            status: "approved",
            approvedByUserId: session.user.id,
            approvedAt: new Date(),
          }
        : // "draft" is the proposer's court: it stays on the day's screen as
          // "הוחזר לתיקון", they edit it, and the edit puts it back in the
          // queue. Deleting it instead would lose the work and say nothing.
          { status: "draft", approvedByUserId: null, approvedAt: null },
      include: { group: { select: { id: true, name: true } } },
    });

    return NextResponse.json(slot);
  } catch (err) {
    return handleApiError(err);
  }
}
