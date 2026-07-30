import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

// POST /api/event-days/:id/activity-slots/reorder — persist a new slot order.
// Body: { orderedIds: string[] }  → order = index.
export async function POST(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const orderedIds: string[] = Array.isArray(body?.orderedIds)
    ? body.orderedIds.filter((x: unknown) => typeof x === "string")
    : [];
  if (orderedIds.length === 0) {
    return NextResponse.json({ error: "רשימה ריקה" }, { status: 400 });
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.activitySlot.update({ where: { id }, data: { order: index } }),
    ),
  );
  return NextResponse.json({ ok: true });
}
