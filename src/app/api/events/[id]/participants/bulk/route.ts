import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { eventNotFound, liveEvent } from "@/lib/event-scope";

// POST /api/events/:id/participants/bulk — add many children to the event at
// once (e.g. all members of a group). Body: { participantIds: string[] }
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("event:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const participantIds: string[] = Array.isArray(body?.participantIds)
      ? body.participantIds.filter((x: unknown) => typeof x === "string")
      : [];

    if (participantIds.length === 0) {
      return NextResponse.json({ error: "רשימה ריקה" }, { status: 400 });
    }

    const event = await prisma.event.findFirst({
      where: liveEvent(params.id),
      select: { id: true },
    });
    if (!event) return eventNotFound();

    await prisma.event.update({
      where: { id: params.id },
      data: { participants: { connect: participantIds.map((id) => ({ id })) } },
    });
    return NextResponse.json({ ok: true, added: participantIds.length });
  } catch (err) {
    return handleApiError(err);
  }
}
