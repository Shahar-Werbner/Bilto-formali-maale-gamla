import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// PATCH /api/activity-slots/:id — update slot fields.
// Body may include: startTime, endTime, title, location, groupId, notes.
// Empty string clears an optional field; groupId "" → whole event.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const data: Record<string, string | null> = {};

  if (body?.startTime !== undefined) {
    const v = typeof body.startTime === "string" ? body.startTime.trim() : "";
    if (!TIME.test(v)) {
      return NextResponse.json({ error: "שעת התחלה לא תקינה" }, { status: 400 });
    }
    data.startTime = v;
  }
  if (body?.endTime !== undefined) {
    const v = typeof body.endTime === "string" ? body.endTime.trim() : "";
    if (v && !TIME.test(v)) {
      return NextResponse.json({ error: "שעת סיום לא תקינה" }, { status: 400 });
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
    data.groupId =
      typeof body.groupId === "string" && body.groupId.trim()
        ? body.groupId.trim()
        : null;
  }

  const slot = await prisma.activitySlot.update({
    where: { id: params.id },
    data,
    include: { group: { select: { id: true, name: true } } },
  });
  return NextResponse.json(slot);
}

// DELETE /api/activity-slots/:id
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  await prisma.activitySlot.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
