import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";

// PATCH /api/groups/:id — rename. Body: { name }
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "שם קבוצה חסר" }, { status: 400 });
    }

    const group = await prisma.group.update({
      where: { id: params.id },
      data: { name },
    });
    return NextResponse.json(group);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/groups/:id — removes the group only. Children stay in the master
// list (membership is many-to-many), and their attendance is untouched.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    await prisma.group.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
