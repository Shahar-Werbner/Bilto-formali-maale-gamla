import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveActivitySlot, slotNotFound } from "@/lib/event-scope";
import { formatDateOnly, todayDateOnly } from "@/lib/attendance";
import { isVerdict, rateBlockReason } from "@/lib/activities";

const MAX_NOTE = 300;

// POST /api/activity-slots/:id/rate — "how did it go?" after an activity from
// the bank ran. Body: { verdict: "worked" | "flopped" | "wrong_age", note? }
//
// One verdict per person per run, and tapping again changes it rather than
// adding a second vote: the ranking counts people's opinions of a run, not
// taps. The rules for *whether* a slot may be rated are in rateBlockReason
// (src/lib/activities.ts): from the bank, approved, and on a day that has come.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { session, response } = await requireCapability("activity:rate");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const verdict = body?.verdict;
    if (!isVerdict(verdict)) {
      return NextResponse.json({ error: "דירוג לא מוכר" }, { status: 400 });
    }
    const note =
      typeof body?.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, MAX_NOTE)
        : null;

    const slot = await prisma.activitySlot.findFirst({
      where: liveActivitySlot(params.id),
      select: {
        id: true,
        status: true,
        activityId: true,
        // An archived activity can still be rated for a run that already
        // happened — the verdict is about the past, and archiving is about
        // what to offer next. It is the slot's event that must be live.
        activity: { select: { id: true } },
        eventDay: { select: { date: true } },
      },
    });
    if (!slot) return slotNotFound();

    const blocked = rateBlockReason({
      activityId: slot.activity?.id,
      status: slot.status,
      date: formatDateOnly(slot.eventDay.date),
      today: todayDateOnly(),
    });
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

    // The note explains a verdict. Re-tapping the same verdict without words
    // (or saving words for it) keeps/updates it; switching to a different
    // verdict drops a note that was written for the old one — "too dark for
    // grade א" must not end up standing under a thumbs-up.
    const existing = await prisma.activityRating.findUnique({
      where: {
        activitySlotId_userId: { activitySlotId: slot.id, userId: session.user.id },
      },
      select: { verdict: true },
    });
    const keepNote = note === null && existing?.verdict === verdict;

    const rating = await prisma.activityRating.upsert({
      where: {
        activitySlotId_userId: { activitySlotId: slot.id, userId: session.user.id },
      },
      create: {
        activityId: slot.activityId as string,
        activitySlotId: slot.id,
        userId: session.user.id,
        verdict,
        note,
      },
      update: keepNote ? { verdict } : { verdict, note },
      select: { verdict: true, note: true },
    });
    return NextResponse.json(rating);
  } catch (err) {
    return handleApiError(err);
  }
}
