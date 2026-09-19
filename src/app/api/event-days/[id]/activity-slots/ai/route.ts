import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveEventDay } from "@/lib/event-scope";
import { parseSchedule } from "@/lib/ai-schedule";
import { formatDateOnly } from "@/lib/attendance";
import { formatHebrewDate } from "@/lib/events";

export const maxDuration = 60;

// Guards against a huge upload turning into a very large (and expensive) model
// request. ~4MB of base64 ≈ a 3MB PDF, which is far more than a day plan needs.
const MAX_PDF_BASE64 = 4_000_000;
const MAX_TEXT = 40_000;

// POST /api/event-days/:id/activity-slots/ai
// Body: { text?: string, pdfBase64?: string }
// Uses Claude to turn free text / a PDF plan into structured schedule slots,
// then creates them for the day.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("schedule:edit");
  if (response) return response;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "תכונת ה-AI אינה מוגדרת (חסר ANTHROPIC_API_KEY)" },
      { status: 503 },
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text : "";
    const pdfBase64 =
      typeof body?.pdfBase64 === "string" ? body.pdfBase64 : undefined;

    if (!text.trim() && !pdfBase64) {
      return NextResponse.json({ error: "לא נשלח טקסט או קובץ" }, { status: 400 });
    }
    if (text.length > MAX_TEXT || (pdfBase64?.length ?? 0) > MAX_PDF_BASE64) {
      return NextResponse.json(
        { error: "הקובץ או הטקסט גדולים מדי" },
        { status: 413 },
      );
    }

    const day = await prisma.eventDay.findFirst({
      where: liveEventDay(params.id),
      select: { id: true, date: true },
    });
    if (!day) {
      return NextResponse.json({ error: "יום לא נמצא" }, { status: 404 });
    }

    const groups = await prisma.group.findMany({ select: { id: true, name: true } });
    const groupByName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g]));

    let parsed;
    try {
      parsed = await parseSchedule({
        text,
        pdfBase64,
        groupNames: groups.map((g) => g.name),
        dateLabel: formatHebrewDate(formatDateOnly(day.date)),
      });
    } catch (err) {
      console.error("[ai-schedule]", err);
      return NextResponse.json(
        { error: (err as Error).message || "עיבוד ה-AI נכשל" },
        { status: 502 },
      );
    }

    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "לא זוהו פעילויות בטקסט" },
        { status: 422 },
      );
    }

    const last = await prisma.activitySlot.findFirst({
      where: { eventDayId: day.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const base = (last?.order ?? -1) + 1;

    // One transaction: a half-imported schedule is worse than a failed import.
    const created = await prisma.$transaction(
      parsed.map((s, i) => {
        const group = s.groupName
          ? groupByName.get(s.groupName.trim().toLowerCase())
          : undefined;
        return prisma.activitySlot.create({
          data: {
            eventDayId: day.id,
            startTime: s.startTime,
            endTime: s.endTime,
            title: s.title,
            location: s.location,
            notes: s.notes,
            groupId: group?.id ?? null,
            order: base + i,
          },
          include: { group: { select: { id: true, name: true } } },
        });
      }),
    );

    return NextResponse.json({ created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
