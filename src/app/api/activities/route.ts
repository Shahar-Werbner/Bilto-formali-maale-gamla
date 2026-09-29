import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, sessionCan } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { gradeRangeError, parseActivityInput } from "@/lib/activities";
import { loadBank } from "@/lib/activity-query";

// GET /api/activities — the bank, best-rated first. `?archived=1` lists the
// archived ones instead, for whoever may restore them.
export async function GET(request: Request) {
  const { response } = await requireCapability("activity:view");
  if (response) return response;

  try {
    const archived = new URL(request.url).searchParams.get("archived") === "1";
    if (archived && !(await sessionCan("activity:edit"))) {
      return NextResponse.json({ error: "אין לך הרשאה לפעולה הזו" }, { status: 403 });
    }
    return NextResponse.json(await loadBank({ archived }));
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/activities — add an activity to the bank.
// Body: { name, description?, durationMinutes?, materials?, tags?, minGrade?, maxGrade? }
export async function POST(request: Request) {
  const { session, response } = await requireCapability("activity:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const parsed = parseActivityInput(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const d = parsed.data;
    const rangeError = gradeRangeError(d.minGrade, d.maxGrade);
    if (rangeError) return NextResponse.json({ error: rangeError }, { status: 400 });

    const activity = await prisma.activity.create({
      data: {
        name: d.name as string,
        description: d.description ?? null,
        durationMinutes: d.durationMinutes ?? null,
        materials: d.materials ?? null,
        tags: d.tags ?? [],
        minGrade: d.minGrade ?? null,
        maxGrade: d.maxGrade ?? null,
        createdByUserId: session.user.id,
      },
    });
    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
