import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";

// POST /api/admin/restore — undo a soft delete.
// Body: { kind: "event" | "participant", id }
export async function POST(request: Request) {
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const kind = body?.kind;

    if (!id || (kind !== "event" && kind !== "participant")) {
      return NextResponse.json({ error: "נתונים חסרים או שגויים" }, { status: 400 });
    }

    if (kind === "event") {
      await prisma.event.update({ where: { id }, data: { deletedAt: null } });
    } else {
      await prisma.participant.update({
        where: { id },
        data: { deletedAt: null },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
