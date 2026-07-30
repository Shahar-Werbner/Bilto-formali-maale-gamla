import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

// POST /api/participants/reorder — persist a new order for a set of participants.
// Body: { orderedIds: string[] }  → sortOrder is set to each id's index.
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
      prisma.participant.update({
        where: { id },
        data: { sortOrder: index },
      }),
    ),
  );

  return NextResponse.json({ ok: true });
}
