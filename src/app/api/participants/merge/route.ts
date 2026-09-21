import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { splitByExistingKeys } from "@/lib/participants";
import { splitAuthorizationsForMerge } from "@/lib/dismissal";

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
          // Who may collect them, how they went home, and which group they were
          // in each session. Losing these on a merge is not a bookkeeping slip:
          // the surviving record would show an empty list of people allowed to
          // take the child home, which looks exactly like "nobody authorised".
          pickupAuth: { select: { id: true, name: true, phone: true } },
          dismissals: { select: { id: true, eventDayId: true } },
          dayGroups: { select: { id: true, eventDayId: true } },
          // Item 5. The links matter for a reason the others do not: a parent
          // is holding that URL in a WhatsApp message, and leaving it on the
          // retiring record turns it into a link that answers "not found" for
          // a family that did nothing wrong.
          parentLinks: { select: { id: true } },
          expected: { select: { id: true, eventDayId: true } },
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

    // Dismissals and day-group assignments are unique per (day, child), same as
    // attendance, so they follow the same rule: the survivor's row stands.
    const [keepDismissals, keepDayGroups, keepAuthorizations, keepExpected] =
      await Promise.all([
        prisma.dismissal.findMany({
          where: { participantId: keepId },
          select: { eventDayId: true },
        }),
        prisma.dayGroupAssignment.findMany({
          where: { participantId: keepId },
          select: { eventDayId: true },
        }),
        prisma.pickupAuthorization.findMany({
          where: { participantId: keepId },
          select: { name: true, phone: true },
        }),
        prisma.expectedAttendance.findMany({
          where: { participantId: keepId },
          select: { eventDayId: true },
        }),
      ]);

    const dismissals = splitByExistingKeys(
      merge.dismissals,
      (d) => d.eventDayId,
      keepDismissals.map((d) => d.eventDayId),
    );
    const dayGroups = splitByExistingKeys(
      merge.dayGroups,
      (a) => a.eventDayId,
      keepDayGroups.map((a) => a.eventDayId),
    );
    // What the parents said is unique per (day, child) like the two above, so
    // it follows the same rule: the survivor's answer stands.
    const expected = splitByExistingKeys(
      merge.expected,
      (e) => e.eventDayId,
      keepExpected.map((e) => e.eventDayId),
    );

    // Pickup authorizations carry no unique constraint — the duplicate here is
    // the same person entered on both records, and moving them across would
    // leave the survivor listing "אמא" twice. The matching rule lives in
    // src/lib/dismissal.ts with the reasoning and its tests; what matters here
    // is its bias: anything that might be a different person moves, because
    // narrowing who may collect a child is the dangerous direction.
    const authorizations = splitAuthorizationsForMerge(
      merge.pickupAuth,
      keepAuthorizations,
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
      prisma.dismissal.updateMany({
        where: { id: { in: dismissals.move.map((d) => d.id) } },
        data: { participantId: keepId },
      }),
      prisma.dismissal.deleteMany({
        where: { id: { in: dismissals.drop.map((d) => d.id) } },
      }),
      prisma.dayGroupAssignment.updateMany({
        where: { id: { in: dayGroups.move.map((a) => a.id) } },
        data: { participantId: keepId },
      }),
      prisma.dayGroupAssignment.deleteMany({
        where: { id: { in: dayGroups.drop.map((a) => a.id) } },
      }),
      prisma.pickupAuthorization.updateMany({
        where: { id: { in: authorizations.move.map((a) => a.id) } },
        data: { participantId: keepId },
      }),
      prisma.pickupAuthorization.deleteMany({
        where: { id: { in: authorizations.drop.map((a) => a.id) } },
      }),
      prisma.expectedAttendance.updateMany({
        where: { id: { in: expected.move.map((e) => e.id) } },
        data: { participantId: keepId },
      }),
      prisma.expectedAttendance.deleteMany({
        where: { id: { in: expected.drop.map((e) => e.id) } },
      }),
      // Every link moves, with no de-duplication: two links are two families'
      // messages, and the survivor holding both is exactly right. A link left
      // behind is a parent whose URL silently stops working.
      prisma.parentLink.updateMany({
        where: { id: { in: merge.parentLinks.map((l) => l.id) } },
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
      // Worth surfacing separately: an admin merging two records should be able
      // to see that the people allowed to collect the child came across.
      movedAuthorizations: authorizations.move.length,
      movedParentLinks: merge.parentLinks.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
