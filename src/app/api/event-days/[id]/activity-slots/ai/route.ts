import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { parseSchedule } from "@/lib/ai-schedule";
import { formatDateOnly } from "@/lib/attendance";
import { formatHebrewDate } from "@/lib/events";

export const maxDuration = 60;

// POST /api/event-days/:id/activity-slots/ai
// Body: { text?: string, pdfBase64?: string }
// Uses Claude to turn free text / a PDF plan into structured schedule slots,
// then creates them for the day.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "תכונת ה-AI אינה מוגדרת (חסר ANTHROPIC_API_KEY)" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const pdfBase64 =
    typeof body?.pdfBase64 === "string" ? body.pdfBase64 : undefined;

  if (!text.trim() && !pdfBase64) {
    return NextResponse.json({ error: "לא נשלח טקסט או קובץ" }, { status: 400 });
  }

  const day = await prisma.eventDay.findUnique({
    where: { id: params.id },
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
  let order = (last?.order ?? -1) + 1;

  const created = [];
  for (const s of parsed) {
    const group = s.groupName
      ? groupByName.get(s.groupName.trim().toLowerCase())
      : undefined;
    const slot = await prisma.activitySlot.create({
      data: {
        eventDayId: day.id,
        startTime: s.startTime,
        endTime: s.endTime,
        title: s.title,
        location: s.location,
        notes: s.notes,
        groupId: group?.id ?? null,
        order: order++,
      },
      include: { group: { select: { id: true, name: true } } },
    });
    created.push(slot);
  }

  return NextResponse.json({ created }, { status: 201 });
}
