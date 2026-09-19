import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import EventBoard from "@/components/EventBoard";
import type { Slot } from "@/components/DaySchedule";
import { formatDateOnly, sortByGrade } from "@/lib/attendance";
import { isEventKind } from "@/lib/events";
import { LIVE_GROUP } from "@/lib/event-scope";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();

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
        />
      </main>
    </>
  );
}
