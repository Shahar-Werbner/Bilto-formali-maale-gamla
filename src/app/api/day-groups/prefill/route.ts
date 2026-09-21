import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import {
  eventDayNotFound,
  liveEventDay,
  LIVE_EVENT,
  LIVE_GROUP,
} from "@/lib/event-scope";
import { formatDateOnly } from "@/lib/attendance";
import { isPrefillSource, prefillAssignments } from "@/lib/day-groups";

// POST /api/day-groups/prefill — fill a day's split from one of three sources.
// Body: { eventDayId, source: "standing" | "previous" | "grade" }
//
// Splitting 40 children by hand, every Tuesday and every Friday, from a phone,
// is the work this replaces. The sources and the rule that prefill only ever
// *adds* live in src/lib/day-groups.ts with their tests.
export async function POST(request: Request) {
  const { response } = await requireCapability("group:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const eventDayId = typeof body?.eventDayId === "string" ? body.eventDayId : "";
    const source = body?.source;

    if (!eventDayId || !isPrefillSource(source)) {
      return NextResponse.json(
        { error: "נתונים חסרים או שגויים" },
        { status: 400 },
      );
    }

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
              select: {
                id: true,
                grade: true,
                // Only live groups: a deleted group is not a home to fill from.
                groups: { where: LIVE_GROUP, select: { id: true } },
              },
            },
          },
        },
      },
    });
    if (!day) return eventDayNotFound();

    const [groups, existing, previousDay] = await Promise.all([
      prisma.group.findMany({
        where: LIVE_GROUP,
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      }),
      prisma.dayGroupAssignment.findMany({
        where: { eventDayId },
        select: { participantId: true, groupId: true },
      }),
      source === "previous"
        ? prisma.eventDay.findFirst({
            where: {
              eventId: day.eventId,
              date: { lt: day.date },
              event: LIVE_EVENT,
              groupAssignments: { some: {} },
            },
            orderBy: { date: "desc" },
            select: {
              id: true,
              date: true,
              groupAssignments: {
                select: { participantId: true, groupId: true },
              },
            },
          })
        : Promise.resolve(null),
    ]);

    const current = new Map(existing.map((a) => [a.participantId, a.groupId]));
    const previous = new Map(
      (previousDay?.groupAssignments ?? []).map((a) => [
        a.participantId,
        a.groupId,
      ]),
    );

    const { assignments, kept, unmatched } = prefillAssignments({
      source,
      groups,
      children: day.event.participants.map((p) => ({
        participantId: p.id,
        grade: p.grade,
        currentGroupId: current.get(p.id) ?? null,
        standingGroupIds: p.groups.map((g) => g.id),
        previousGroupId: previous.get(p.id) ?? null,
      })),
    });

    // skipDuplicates because the unique key is (day, child): if someone placed
    // a child from another phone while this ran, their choice stands rather
    // than the request failing outright.
    if (assignments.length > 0) {
      await prisma.dayGroupAssignment.createMany({
        data: assignments.map((a) => ({ eventDayId, ...a })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({
      source,
      filled: assignments.length,
      kept: kept.length,
      unmatched: unmatched.length,
      previousDay: previousDay
        ? { id: previousDay.id, date: formatDateOnly(previousDay.date) }
        : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
