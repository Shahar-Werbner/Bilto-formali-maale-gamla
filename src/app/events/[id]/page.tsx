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
import { eventUsesRegistration } from "@/lib/registration-server";
import { dayEquipment } from "@/lib/registration-overview";
import { foodByDay, registrationNotesByDay } from "@/lib/registration-overview-server";

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
        registration: { select: { equipment: true, openedAt: true } },
        participants: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
        },
        days: {
          orderBy: { date: "asc" },
          include: {
            activitySlots: {
              orderBy: [{ order: "asc" }, { startTime: "asc" }],
              include: {
                group: { select: { id: true, name: true } },
                activity: { select: { id: true, name: true } },
                // Only my own verdict: the day screen asks "how did it go?"
                // of the person holding the phone. The totals live in the bank.
                ratings: session?.user?.id
                  ? { where: { userId: session.user.id }, select: { verdict: true } }
                  : { where: { id: "" }, select: { verdict: true } },
              },
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

  // Item 8: with a registration link, only the children who registered are
  // expected — see expectedHeadcount() in src/lib/parents.ts.
  const byRegistration = await eventUsesRegistration(event.id);

  // Item 8b: what the registrations add to the day — how many bring food,
  // and the free notes parents wrote for the staff. A phone number inside a
  // note is hidden from whoever may not see contacts.
  const [food, notesByDay] = byRegistration
    ? await Promise.all([
        foodByDay(event.id),
        registrationNotesByDay(event.id, {
          withContacts: capabilities.includes("roster:contacts"),
        }),
      ])
    : [{}, {}];

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
      activityId: s.activity?.id ?? null,
      activityName: s.activity?.name ?? null,
      myVerdict: s.ratings[0]?.verdict ?? null,
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
      expected: {
        ...(expectedByDay[d.id] ?? { coming: 0, notComing: 0 }),
        byRegistration,
        food: byRegistration ? food[d.id] : undefined,
      },
      // "היום צריך: …" — checked at the gate, not only asked for in the form.
      equipment: dayEquipment(event.registration?.equipment ?? [], d.equipment),
      registrationNotes: sortByGrade(notesByDay[d.id] ?? []),
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
        {(capabilities.includes("registration:manage") ||
          (event.registration?.openedAt && capabilities.includes("event:view"))) && (
          <a
            href={`/events/${event.id}/registration`}
            className="mb-3 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            📝 {capabilities.includes("registration:manage") ? "טופס הרשמה" : "הרשמה"}
          </a>
        )}
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
