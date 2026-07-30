import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

// POST /api/groups/:id/members — add a participant to the group.
// Body: { participantId }
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const participantId =
    typeof body?.participantId === "string" ? body.participantId : "";
  if (!participantId) {
    return NextResponse.json({ error: "חסר מזהה משתתף" }, { status: 400 });
  }

  await prisma.group.update({
    where: { id: params.id },
    data: { participants: { connect: { id: participantId } } },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/groups/:id/members?participantId=... — remove from the group
// (the participant itself stays in the master list).
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  const participantId =
    new URL(request.url).searchParams.get("participantId") ?? "";
  if (!participantId) {
    return NextResponse.json({ error: "חסר מזהה משתתף" }, { status: 400 });
  }

  await prisma.group.update({
    where: { id: params.id },
    data: { participants: { disconnect: { id: participantId } } },
  });
  return NextResponse.json({ ok: true });
}
