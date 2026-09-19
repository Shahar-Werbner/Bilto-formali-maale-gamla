import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { groupNotFound, liveGroup } from "@/lib/event-scope";

// POST /api/groups/:id/members — add a participant to the group.
// Body: { participantId }
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("group:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const participantId =
      typeof body?.participantId === "string" ? body.participantId : "";
    if (!participantId) {
      return NextResponse.json({ error: "חסר מזהה משתתף" }, { status: 400 });
    }

    // A deleted group must not keep gaining or losing members from a stale
    // screen — it is gone everywhere else, so it answers as missing here too.
    if (!(await prisma.group.findFirst({ where: liveGroup(params.id) }))) {
      return groupNotFound();
    }

    await prisma.group.update({
      where: { id: params.id },
      data: { participants: { connect: { id: participantId } } },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/groups/:id/members?participantId=... — remove from the group
// (the participant itself stays in the master list).
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("group:edit");
  if (response) return response;

  try {
    const participantId =
      new URL(request.url).searchParams.get("participantId") ?? "";
    if (!participantId) {
      return NextResponse.json({ error: "חסר מזהה משתתף" }, { status: 400 });
    }

    // A deleted group must not keep gaining or losing members from a stale
    // screen — it is gone everywhere else, so it answers as missing here too.
    if (!(await prisma.group.findFirst({ where: liveGroup(params.id) }))) {
      return groupNotFound();
    }

    await prisma.group.update({
      where: { id: params.id },
      data: { participants: { disconnect: { id: participantId } } },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
