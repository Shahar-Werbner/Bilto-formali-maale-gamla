import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

// DELETE /api/events/:id — removes the event, its days and their attendance
// (cascade). The event's participants themselves are not deleted.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  await prisma.event.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
