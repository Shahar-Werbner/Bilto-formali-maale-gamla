import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import EventBoard from "@/components/EventBoard";
import type { Slot } from "@/components/DaySchedule";
import { formatDateOnly, sortByGrade } from "@/lib/attendance";
import { isEventKind } from "@/lib/events";
import { sessionCapabilities } from "@/lib/api-auth";
import { LIVE_GROUP } from "@/lib/event-scope";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const capabilities = await sessionCapabilities();

  const [event, groups] = await Promise.all([
    prisma.event.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        weekdays: { orderBy: { weekday: "asc" } },
        participants: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
        },
        days: {
          orderBy: { date: "asc" },
          include: {
            activitySlots: {
              orderBy: [{ order: "asc" }, { startTime: "asc" }],
              include: { group: { select: { id: true, name: true } } },
            },
          },
        },
      },
    }),
    prisma.group.findMany({
      where: LIVE_GROUP,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        participants: { where: { deletedAt: null }, select: { id: true } },
      },
    }),
  ]);

  const plainGroups = groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberIds: g.participants.map((p) => p.id),
  }));

  const allParticipants = sortByGrade(
    await prisma.participant.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, grade: true },
    }),
  );

  if (!event) notFound();

  // What the parents said, per day (item 5). Grouped in the database rather
  // than fetched row by row: a year of Tuesdays and Fridays times fifty
  // children is thousands of rows for two numbers per day.
  //
  // Scoped to children still on this event and not soft-deleted, because the
  // answer outlives the membership: a child taken off the event must not keep
  // lowering the number the kitchen cooks to.
  const expectedRows = await prisma.expectedAttendance.groupBy({
    by: ["eventDayId", "coming"],
    where: {
      eventDay: { eventId: event.id },
      participant: { deletedAt: null, events: { some: { id: event.id } } },
    },
    _count: { _all: true },
  });

  const expectedByDay: Record<string, { coming: number; notComing: number }> = {};
  for (const row of expectedRows) {
    const bucket = (expectedByDay[row.eventDayId] ??= { coming: 0, notComing: 0 });
    if (row.coming) bucket.coming += row._count._all;
    else bucket.notComing += row._count._all;
  }

  const slotsByDay: Record<string, Slot[]> = {};
  for (const d of event.days) {
    slotsByDay[d.id] = d.activitySlots.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      title: s.title,
      location: s.location,
      groupId: s.groupId,
      groupName: s.group?.name ?? null,
      notes: s.notes,
      order: s.order,
      status: s.status,
    }));
  }

  const data = {
    id: event.id,
    name: event.name,
    startDate: formatDateOnly(event.startDate),
    endDate: formatDateOnly(event.endDate),
    kind: isEventKind(event.kind) ? event.kind : ("camp" as const),
    includeFriday: event.includeFriday,
    includeSaturday: event.includeSaturday,
    defaultStartTime: event.defaultStartTime,
    defaultEndTime: event.defaultEndTime,
    maxChildrenPerStaff: event.maxChildrenPerStaff,
    weekdays: event.weekdays.map((w) => ({
      weekday: w.weekday,
      startTime: w.startTime,
      endTime: w.endTime,
    })),
    participants: sortByGrade(
      event.participants.map((p) => ({
        id: p.id,
        name: p.name,
        grade: p.grade,
      })),
    ),
    days: event.days.map((d) => ({
      id: d.id,
      date: formatDateOnly(d.date),
      description: d.description,
      startTime: d.startTime,
      endTime: d.endTime,
      expected: expectedByDay[d.id] ?? { coming: 0, notComing: 0 },
    })),
  };

  return (
    <>
      <AppHeader
        active="/events"
        userName={session?.user?.name}
        isAdmin={session?.user?.role === "admin"}
      />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <EventBoard
          event={data}
          groups={plainGroups}
          slotsByDay={slotsByDay}
          allParticipants={allParticipants}
          capabilities={capabilities}
        />
      </main>
    </>
  );
}
