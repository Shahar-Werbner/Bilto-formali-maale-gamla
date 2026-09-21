import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import {
  eventDayNotFound,
  groupNotFound,
  liveEventDay,
  liveGroup,
  LIVE_EVENT,
  LIVE_GROUP,
} from "@/lib/event-scope";
import { formatDateOnly, sortByGrade } from "@/lib/attendance";

// Which group each child is in, for one session.
//
// The groups change from week to week here, so the day's assignments are the
// truth for that day and the standing membership is only a default to fill
// from — see src/lib/day-groups.ts. Nothing in this file writes to the
// standing membership: assigning a child for a Tuesday must not move them out
// of "the Lions" for the year.

// GET /api/day-groups?eventDayId=... — the day's split, in one request.
export async function GET(request: Request) {
  const { response } = await requireCapability("group:view");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const eventDayId = searchParams.get("eventDayId") ?? "";
    if (!eventDayId) {
      return NextResponse.json({ error: "חסר מזהה יום" }, { status: 400 });
    }

    // The id of a day says nothing about whether its event still exists.
    const day = await prisma.eventDay.findFirst({
      where: liveEventDay(eventDayId),
      select: {
        id: true,
        date: true,
        eventId: true,
        event: {
          select: {
            participants: {
              where: { deletedAt: null },
              select: { id: true, name: true, grade: true },
            },
          },
        },
      },
    });
    if (!day) return eventDayNotFound();

    const [assignments, liveGroups, previousDay] = await Promise.all([
      prisma.dayGroupAssignment.findMany({
        where: { eventDayId },
        select: {
          participantId: true,
          groupId: true,
          group: { select: { id: true, name: true, deletedAt: true } },
        },
      }),
      prisma.group.findMany({
        where: LIVE_GROUP,
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      }),
      // The session this day would copy from: the most recent earlier day of
      // the same event that was actually split. The screen names it, so
      // "copy from the previous session" says which one.
      prisma.eventDay.findFirst({
        where: {
          eventId: day.eventId,
          date: { lt: day.date },
          event: LIVE_EVENT,
          groupAssignments: { some: {} },
        },
        orderBy: { date: "desc" },
        select: { id: true, date: true },
      }),
    ]);

    const byParticipant = new Map(assignments.map((a) => [a.participantId, a]));

    // A group deleted after the split still has to appear, or this day would
    // show part of its children with no group at all — the exact failure that
    // made Group soft-deleted in the first place. It is listed as deleted, so
    // the screen can show it without offering it for new assignments.
    const groups: Array<{ id: string; name: string; deleted?: true }> = [
      ...liveGroups,
    ];
    const seen = new Set(groups.map((g) => g.id));
    for (const a of assignments) {
      if (a.group.deletedAt && !seen.has(a.group.id)) {
        seen.add(a.group.id);
        groups.push({ id: a.group.id, name: a.group.name, deleted: true });
      }
    }

    const children = sortByGrade(day.event.participants).map((p) => ({
      participantId: p.id,
      name: p.name,
      grade: p.grade,
      groupId: byParticipant.get(p.id)?.groupId ?? null,
    }));

    return NextResponse.json({
      groups,
      children,
      previousDay: previousDay
        ? { id: previousDay.id, date: formatDateOnly(previousDay.date) }
        : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/day-groups — put one child in one group for one day.
// Body: { eventDayId, participantId, groupId }
export async function POST(request: Request) {
  const { response } = await requireCapability("group:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const eventDayId = typeof body?.eventDayId === "string" ? body.eventDayId : "";
    const participantId =
      typeof body?.participantId === "string" ? body.participantId : "";
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";

    if (!eventDayId || !participantId || !groupId) {
      return NextResponse.json({ error: "נתונים חסרים" }, { status: 400 });
    }

    // Same rule as attendance: only a child who is on this event, on a day
    // whose event has not been deleted.
    const day = await prisma.eventDay.findFirst({
      where: {
        id: eventDayId,
        event: {
          ...LIVE_EVENT,
          participants: { some: { id: participantId, deletedAt: null } },
        },
      },
      select: { id: true },
    });
    if (!day) {
      return NextResponse.json(
        { error: "המשתתף אינו רשום לאירוע זה" },
        { status: 404 },
      );
    }

    // A deleted group is gone from every picker, so a phone still holding its
    // id must not be able to place a child in it.
    if (!(await prisma.group.findFirst({ where: liveGroup(groupId) }))) {
      return groupNotFound();
    }

    // One group per child per day (the unique constraint): moving a child is
    // an update of the same row, not a second assignment.
    await prisma.dayGroupAssignment.upsert({
      where: { eventDayId_participantId: { eventDayId, participantId } },
      update: { groupId },
      create: { eventDayId, participantId, groupId },
    });

    return NextResponse.json({ participantId, groupId });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/day-groups?eventDayId=...&participantId=... — take one child out
// of their group for this day, or, with `all=1` and no participant, clear the
// day's split so it can be filled again from a different source.
//
// Clearing takes a child out of *this day's* split only. Their standing
// membership is untouched, which is why this does not need group:delete: the
// record being removed is today's plan, not a group.
export async function DELETE(request: Request) {
  const { response } = await requireCapability("group:edit");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const eventDayId = searchParams.get("eventDayId") ?? "";
    const participantId = searchParams.get("participantId") ?? "";
    const all = searchParams.get("all") === "1";

    if (!eventDayId || (!participantId && !all)) {
      return NextResponse.json({ error: "חסרים מזהים" }, { status: 400 });
    }

    const deleted = await prisma.dayGroupAssignment.deleteMany({
      where: {
        eventDayId,
        ...(participantId ? { participantId } : {}),
        eventDay: { event: LIVE_EVENT },
      },
    });

    // Clearing a day that was never split is not an error — the screen ends up
    // where the person asked it to be either way. Removing one child who has
    // no group is, because it means the screen and the database disagree.
    if (deleted.count === 0 && participantId) {
      return NextResponse.json({ error: "לא נמצא שיבוץ" }, { status: 404 });
    }
    return NextResponse.json({ cleared: deleted.count });
  } catch (err) {
    return handleApiError(err);
  }
}
