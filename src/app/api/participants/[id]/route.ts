import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

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
