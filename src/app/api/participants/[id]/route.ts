import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";

// PATCH /api/participants/:id — update name and/or grade (כיתה).
// Body: { name?, grade? }  (grade "" clears it)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const data: {
      name?: string;
      grade?: string | null;
      parentName?: string | null;
      parentPhone?: string | null;
      phone?: string | null;
    } = {};

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
    for (const field of ["parentName", "parentPhone", "phone"] as const) {
      if (typeof body?.[field] === "string") {
        data[field] = body[field].trim() || null;
      }
    }

    const participant = await prisma.participant.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json(participant);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/participants/:id — soft delete. The child disappears from every
// list, but their attendance history stays intact and an admin can restore
// them from /admin. Admin only: this row is the child's whole record.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    await prisma.participant.update({
      where: { id: params.id },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
