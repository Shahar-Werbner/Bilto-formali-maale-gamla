import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, sessionCan } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveGroup, liveActivitySlot, slotNotFound } from "@/lib/event-scope";
import { canChangeSlot, statusAfterEdit } from "@/lib/schedule";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// PATCH /api/activity-slots/:id — update slot fields.
// Body may include: startTime, endTime, title, location, groupId, notes.
// Empty string clears an optional field; groupId "" → whole event.
//
// Open to anyone who may propose, but only for a slot that is not part of the
// day yet — see canChangeSlot in src/lib/schedule.ts. An approved slot answers
// 403 to a proposer, so a youth counselor can fix their own plan and cannot
// rewrite the session.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("schedule:propose");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const data: Record<string, string | null> = {};

    if (body?.startTime !== undefined) {
      const v = typeof body.startTime === "string" ? body.startTime.trim() : "";
      if (!TIME.test(v)) {
        return NextResponse.json(
          { error: "שעת התחלה לא תקינה" },
          { status: 400 },
        );
      }
      data.startTime = v;
    }
    if (body?.endTime !== undefined) {
      const v = typeof body.endTime === "string" ? body.endTime.trim() : "";
      if (v && !TIME.test(v)) {
        return NextResponse.json(
          { error: "שעת סיום לא תקינה" },
          { status: 400 },
        );
      }
      data.endTime = v || null;
    }
    if (body?.title !== undefined) {
      const v = typeof body.title === "string" ? body.title.trim() : "";
      if (!v) {
        return NextResponse.json({ error: "כותרת חסרה" }, { status: 400 });
      }
      data.title = v;
    }
    if (body?.location !== undefined) {
      data.location =
        typeof body.location === "string" && body.location.trim()
          ? body.location.trim()
          : null;
    }
    if (body?.notes !== undefined) {
      data.notes =
        typeof body.notes === "string" && body.notes.trim()
          ? body.notes.trim()
          : null;
    }
    if (body?.groupId !== undefined) {
      const v =
        typeof body.groupId === "string" && body.groupId.trim()
          ? body.groupId.trim()
          : null;
      // An unknown id would only fail later as a foreign-key error, so check it
      // here and answer with something the UI can show.
      if (v && !(await prisma.group.findFirst({ where: liveGroup(v) }))) {
        return NextResponse.json({ error: "קבוצה לא נמצאה" }, { status: 400 });
      }
      data.groupId = v;
    }

    // `update` takes no relation filter, so confirm the slot hangs off a live
    // event before writing to it.
    const owned = await prisma.activitySlot.findFirst({
      where: liveActivitySlot(params.id),
      select: { id: true, status: true },
    });
    if (!owned) return slotNotFound();

    const canEdit = await sessionCan("schedule:edit");
    if (!canChangeSlot({ status: owned.status, canEdit, canPropose: true })) {
      return NextResponse.json(
        { error: "הפעילות כבר אושרה — שינוי שלה הוא באחריות בוגר/ת" },
        { status: 403 },
      );
    }

    const slot = await prisma.activitySlot.update({
      where: { id: params.id },
      data: {
        ...data,
        // A corrected proposal goes back into the queue. Without this a slot
        // sent back for a fix would stay in "הוחזר לתיקון" after being fixed,
        // waiting for a re-submit button that does not exist.
        status: statusAfterEdit({ status: owned.status, canEdit }),
      },
      include: { group: { select: { id: true, name: true } } },
    });
    return NextResponse.json(slot);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/activity-slots/:id — same rule as PATCH: a proposer may withdraw
// a plan that is not part of the day yet, and nothing else.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("schedule:propose");
  if (response) return response;

  try {
    const owned = await prisma.activitySlot.findFirst({
      where: liveActivitySlot(params.id),
      select: { id: true, status: true },
    });
    if (!owned) return slotNotFound();

    const canEdit = await sessionCan("schedule:edit");
    if (!canChangeSlot({ status: owned.status, canEdit, canPropose: true })) {
      return NextResponse.json(
        { error: "הפעילות כבר אושרה — מחיקה שלה היא באחריות בוגר/ת" },
        { status: 403 },
      );
    }

    const deleted = await prisma.activitySlot.deleteMany({
      where: liveActivitySlot(params.id),
    });
    if (deleted.count === 0) return slotNotFound();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
