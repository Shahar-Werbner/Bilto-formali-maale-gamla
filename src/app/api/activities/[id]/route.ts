import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { gradeRangeError, parseActivityInput } from "@/lib/activities";
import { activityNotFound, liveActivity } from "@/lib/event-scope";

// PATCH /api/activities/:id — edit a bank entry, or `{ restore: true }` to
// bring an archived one back.
//
// Editing never touches slots that already used the activity: each slot keeps
// its own title and notes, so what a past session says it did stays what it
// did.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("activity:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);

    if (body?.restore === true) {
      const restored = await prisma.activity.updateMany({
        where: { id: params.id, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      if (restored.count === 0) return activityNotFound();
      return NextResponse.json({ ok: true });
    }

    const parsed = parseActivityInput(body, { partial: true });
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const current = await prisma.activity.findFirst({
      where: liveActivity(params.id),
      select: { minGrade: true, maxGrade: true },
    });
    if (!current) return activityNotFound();

    // The range is checked against the result, not the request: changing only
    // minGrade can reverse a range whose maxGrade was set last month.
    const rangeError = gradeRangeError(
      parsed.data.minGrade !== undefined ? parsed.data.minGrade : current.minGrade,
      parsed.data.maxGrade !== undefined ? parsed.data.maxGrade : current.maxGrade,
    );
    if (rangeError) return NextResponse.json({ error: rangeError }, { status: 400 });

    const activity = await prisma.activity.update({
      where: { id: params.id },
      data: parsed.data,
    });
    return NextResponse.json(activity);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/activities/:id — archive. Never a hard delete: past slots point
// at the activity and its ratings are the whole value of the row.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("activity:edit");
  if (response) return response;

  try {
    const archived = await prisma.activity.updateMany({
      where: liveActivity(params.id),
      data: { deletedAt: new Date() },
    });
    if (archived.count === 0) return activityNotFound();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
