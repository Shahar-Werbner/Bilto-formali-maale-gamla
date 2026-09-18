import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";

// PATCH /api/event-days/:id — update the activity description for a day.
// Body: { description }  ("" clears it)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.description !== "string") {
      return NextResponse.json({ error: "תיאור חסר" }, { status: 400 });
    }
    const description = body.description.trim() || null;

    const day = await prisma.eventDay.update({
      where: { id: params.id },
      data: { description },
    });
    return NextResponse.json({ id: day.id, description: day.description });
  } catch (err) {
    return handleApiError(err);
  }
}
