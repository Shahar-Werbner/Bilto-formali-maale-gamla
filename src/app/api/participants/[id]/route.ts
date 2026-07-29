import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

// PATCH /api/participants/:id — update name and/or grade (כיתה).
// Body: { name?, grade? }  (grade "" clears it)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const data: { name?: string; grade?: string | null } = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "שם משתתף חסר" }, { status: 400 });
    }
    data.name = name;
  }
  if (typeof body?.grade === "string") {
    data.grade = body.grade.trim() || null;
  }

  const participant = await prisma.participant.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json(participant);
}

// DELETE /api/participants/:id — removes the participant and their attendance
// records (cascade defined in the schema).
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  await prisma.participant.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
