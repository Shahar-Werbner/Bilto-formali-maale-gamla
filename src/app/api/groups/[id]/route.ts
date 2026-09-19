import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { groupNotFound, liveGroup } from "@/lib/event-scope";

// PATCH /api/groups/:id — rename. Body: { name }
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("group:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "שם קבוצה חסר" }, { status: 400 });
    }

    // Renaming a deleted group would bring nothing back and hides a stale UI.
    const existing = await prisma.group.findFirst({
      where: liveGroup(params.id),
    });
    if (!existing) return groupNotFound();

    const group = await prisma.group.update({
      where: { id: params.id },
      data: { name },
    });
    return NextResponse.json(group);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/groups/:id — soft delete. Children stay in the master list and
// their attendance is untouched, as before.
//
// This used to be a hard delete, which was fine while a group was only a
// reusable label. It stopped being fine once DayGroupAssignment recorded which
// group a child was in on a given day: the cascade took those rows with it, so
// a past session that had three children rendered as one afterwards, with
// nothing to say a group had ever been deleted. Deleting in the present must
// not rewrite the past.
//
// `group:delete` rather than `group:edit`: deleting a group is not editing one.
// It hides a name that past sessions still refer to, which is the same class of
// act as deleting a child or an event, and those are admin-only already. Owner's
// decision, 19.09. Editing a group stays open to any adult counselor.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("group:delete");
  if (response) return response;

  try {
    // findFirst + update rather than update alone: deleting an already-deleted
    // group should read as "not found", not succeed silently.
    const group = await prisma.group.findFirst({ where: liveGroup(params.id) });
    if (!group) return groupNotFound();

    await prisma.group.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
