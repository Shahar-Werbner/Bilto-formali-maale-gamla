import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

// PATCH /api/groups/:id — rename. Body: { name }
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

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
}

// DELETE /api/groups/:id — removes the group, its participants and their
// attendance records (cascade defined in the schema).
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  await prisma.group.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
