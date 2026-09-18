import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";

// POST /api/participants/merge — fold one child's record into another.
// Body: { keepId, mergeId }
//
// The same child entered twice ends up with their history split across two
// rows. This moves everything onto `keepId` and retires `mergeId`.
//
// Admin only: it rewrites attendance history, same class of operation as a
// delete. `mergeId` is soft-deleted rather than removed, so a mistaken merge
// leaves the row recoverable from /admin (its attendance now lives on the
// surviving child).
export async function POST(request: Request) {
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const keepId = typeof body?.keepId === "string" ? body.keepId : "";
    const mergeId = typeof body?.mergeId === "string" ? body.mergeId : "";

    if (!keepId || !mergeId) {
      return NextResponse.json({ error: "חסרים מזהים" }, { status: 400 });
    }
    if (keepId === mergeId) {
      return NextResponse.json(
        { error: "אי אפשר למזג רשומה לעצמה" },
        { status: 400 },
      );
    }

    const [keep, merge] = await Promise.all([
      prisma.participant.findFirst({
        where: { id: keepId, deletedAt: null },
        include: { groups: { select: { id: true } }, events: { select: { id: true } } },
      }),
      prisma.participant.findFirst({
        where: { id: mergeId, deletedAt: null },
        include: {
          groups: { select: { id: true } },
          events: { select: { id: true } },
          eventMarks: { select: { id: true, eventDayId: true } },
          attendance: { select: { id: true, date: true } },
        },
      }),
    ]);
    if (!keep || !merge) {
      return NextResponse.json({ error: "ילד/ה לא נמצא/ה" }, { status: 404 });
    }

    // Attendance is unique per (day, child). Where both records were marked on
    // the same day the surviving record's mark stands — it is the one the team
    // has been looking at — and the duplicate's mark is dropped rather than
    // silently overwriting it.
    const keepMarks = await prisma.eventAttendance.findMany({
      where: { participantId: keepId },
      select: { eventDayId: true },
    });
    const keepDays = new Set(keepMarks.map((m) => m.eventDayId));
    const marksToMove = merge.eventMarks.filter((m) => !keepDays.has(m.eventDayId));
    const marksToDrop = merge.eventMarks.filter((m) => keepDays.has(m.eventDayId));

    // Same rule for the legacy daily records, so nothing is left dangling.
    const keepLegacy = await prisma.attendanceRecord.findMany({
      where: { participantId: keepId },
      select: { date: true },
    });
    const keepDates = new Set(keepLegacy.map((r) => r.date.getTime()));
    const legacyToMove = merge.attendance.filter(
      (r) => !keepDates.has(r.date.getTime()),
    );

    // Fill in anything the surviving record is missing.
    const fill: Record<string, string> = {};
    for (const field of ["grade", "parentName", "parentPhone", "phone"] as const) {
      if (!keep[field] && merge[field]) fill[field] = merge[field]!;
    }

    await prisma.$transaction([
      prisma.eventAttendance.updateMany({
        where: { id: { in: marksToMove.map((m) => m.id) } },
        data: { participantId: keepId },
      }),
      prisma.eventAttendance.deleteMany({
        where: { id: { in: marksToDrop.map((m) => m.id) } },
      }),
      prisma.attendanceRecord.updateMany({
        where: { id: { in: legacyToMove.map((r) => r.id) } },
        data: { participantId: keepId },
      }),
      prisma.participant.update({
        where: { id: keepId },
        data: {
          ...fill,
          groups: { connect: merge.groups.map((g) => ({ id: g.id })) },
          events: { connect: merge.events.map((e) => ({ id: e.id })) },
        },
      }),
      prisma.participant.update({
        where: { id: mergeId },
        data: { deletedAt: new Date() },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      movedMarks: marksToMove.length,
      droppedMarks: marksToDrop.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
