import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveActivitySlot, slotNotFound } from "@/lib/event-scope";
import { hoursBetween } from "@/lib/events";

// POST /api/activity-slots/:id/to-bank — "this one was good, keep it".
//
// The bank grows from what was actually done: a slot typed straight into a
// day becomes a bank entry in one tap, and the slot is linked to it so the
// run it came from can be rated. Name and description come from the slot;
// the duration from its hours when it has both. Anything else — tags, grades,
// materials — is filled in on the bank screen later, or never.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { session, response } = await requireCapability("activity:edit");
  if (response) return response;

  try {
    const slot = await prisma.activitySlot.findFirst({
      where: liveActivitySlot(params.id),
      select: {
        id: true,
        title: true,
        notes: true,
        startTime: true,
        endTime: true,
        activityId: true,
      },
    });
    if (!slot) return slotNotFound();
    if (slot.activityId) {
      return NextResponse.json({ error: "הפעילות כבר במאגר" }, { status: 409 });
    }

    const minutes = Math.round(hoursBetween(slot.startTime, slot.endTime) * 60);

    const updated = await prisma.$transaction(async (tx) => {
      const activity = await tx.activity.create({
        data: {
          name: slot.title,
          description: slot.notes,
          durationMinutes: minutes > 0 ? minutes : null,
          tags: [],
          createdByUserId: session.user.id,
        },
      });
      // Conditional on the slot still being unlinked: two phones tapping at
      // once would otherwise make two bank entries and link the slot to one.
      const linked = await tx.activitySlot.updateMany({
        where: { id: slot.id, activityId: null },
        data: { activityId: activity.id },
      });
      if (linked.count === 0) throw new AlreadyLinked();
      return activity;
    });
    return NextResponse.json(
      { activityId: updated.id, activityName: updated.name },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof AlreadyLinked) {
      return NextResponse.json({ error: "הפעילות כבר במאגר" }, { status: 409 });
    }
    return handleApiError(err);
  }
}

class AlreadyLinked extends Error {}
