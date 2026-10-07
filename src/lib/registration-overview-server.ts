// The queries behind the staff's registration overview and the day screen's
// registration lines (item 8b). Server-only. The rules they feed are in
// registration-overview.ts.
//
// Every count here is scoped exactly like the day screen's expected number
// (src/app/events/[id]/page.tsx): children not soft-deleted and still on the
// event. Two screens that disagree about how many are coming tomorrow is the
// bug — the kitchen asks one person and gets two numbers.

import { prisma } from "@/lib/prisma";
import { formatDateOnly, todayDateOnly } from "@/lib/attendance";
import { LIVE_EVENT } from "@/lib/event-scope";
import { isEventKind } from "@/lib/events";
import { formDays, type RegistrationStatus } from "@/lib/registration";
import {
  foodCountFromGroups,
  hidePhones,
  notYetRegistered,
  previousEvent,
  previousParticipants,
  type FoodCount,
} from "@/lib/registration-overview";

/** Per day: the kitchen's numbers, from ExpectedAttendance (what the day screen reads). */
export async function foodByDay(eventId: string): Promise<Record<string, FoodCount>> {
  const groups = await prisma.expectedAttendance.groupBy({
    by: ["eventDayId", "coming", "bringsFood"],
    where: {
      eventDay: { eventId },
      participant: { deletedAt: null, events: { some: { id: eventId } } },
    },
    _count: { _all: true },
  });
  const byDay = new Map<string, { coming: boolean; bringsFood: boolean | null; count: number }[]>();
  for (const g of groups) {
    const list = byDay.get(g.eventDayId) ?? [];
    list.push({ coming: g.coming, bringsFood: g.bringsFood, count: g._count._all });
    byDay.set(g.eventDayId, list);
  }
  return Object.fromEntries([...byDay].map(([id, list]) => [id, foodCountFromGroups(list)]));
}

export type DayNote = { name: string; grade: string | null; note: string };

/**
 * The free notes parents wrote in the form, for the children coming on each
 * day. Only approved registrations: a pending or waiting-list child is not
 * expected, and a rejected one is not coming.
 *
 * Without `roster:contacts` a phone number typed into the note is hidden —
 * the note reaches the youth counselor running the day, the number does not.
 */
export async function registrationNotesByDay(
  eventId: string,
  { withContacts }: { withContacts: boolean },
): Promise<Record<string, DayNote[]>> {
  const rows = await prisma.registration.findMany({
    where: {
      form: { eventId, event: LIVE_EVENT },
      status: "approved",
      note: { not: null },
      participant: { deletedAt: null, events: { some: { id: eventId } } },
    },
    select: {
      note: true,
      participant: { select: { name: true, grade: true } },
      days: { where: { coming: true }, select: { eventDayId: true } },
    },
  });
  const out: Record<string, DayNote[]> = {};
  for (const r of rows) {
    const text = r.note?.trim();
    if (!text || !r.participant) continue;
    const note = withContacts ? text : hidePhones(text);
    for (const d of r.days) {
      (out[d.eventDayId] ??= []).push({
        name: r.participant.name,
        grade: r.participant.grade,
        note,
      });
    }
  }
  return out;
}

// ── The overview on the registration page ───────────────────────────────────

export type OverviewDay = {
  id: string;
  date: string;
  food: FoodCount;
};

export type OverviewChild = {
  id: string;
  name: string;
  grade: string | null;
  status: RegistrationStatus;
  isNew: boolean;
  updated: boolean;
  /**
   * Something here waits for an adult: the registration itself, or a change
   * to who collects the child. The same rule as the approval queue
   * (staffRegistrations), so the number on top and the queue below agree.
   */
  needsReview: boolean;
  /** Event days this child is registered as coming, by id. */
  comingDayIds: string[];
  note: string | null;
  /** Only with roster:contacts — never selected otherwise. */
  parentName: string | null;
  parentPhone: string | null;
};

export type RegistrationOverviewData = {
  days: OverviewDay[];
  children: OverviewChild[];
  previous: {
    name: string;
    basis: "attended" | "rostered";
    notRegistered: { id: string; name: string; grade: string | null }[];
  } | null;
};

export async function registrationOverview(
  event: { id: string; kind: string; startDate: Date; endDate: Date },
  formId: string,
  { withContacts }: { withContacts: boolean },
): Promise<RegistrationOverviewData> {
  const [regs, eventDays, food, others] = await Promise.all([
    prisma.registration.findMany({
      where: {
        formId,
        // A registration whose child was deleted since is gone with the child
        // (invariant 1). A new child not yet approved has no record to check.
        OR: [{ participantId: null }, { participant: { deletedAt: null } }],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        participantId: true,
        childName: true,
        childGrade: true,
        status: true,
        revision: true,
        note: true,
        reviewReasons: true,
        reviewedAt: true,
        // Field-level: the columns are not read without the capability.
        parentName: withContacts,
        parentPhone: withContacts,
        participant: { select: { name: true, grade: true } },
        days: { where: { coming: true }, select: { eventDayId: true } },
      },
    }),
    prisma.eventDay.findMany({
      where: { eventId: event.id },
      orderBy: { date: "asc" },
      select: { id: true, date: true },
    }),
    foodByDay(event.id),
    prisma.event.findMany({
      where: { ...LIVE_EVENT, id: { not: event.id }, startDate: { lt: event.startDate } },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),
  ]);

  // The days worth a row: the ones the form asks about now, and any earlier
  // day somebody already answered for.
  const answeredDays = new Set(regs.flatMap((r) => r.days.map((d) => d.eventDayId)));
  for (const id of Object.keys(food)) answeredDays.add(id);
  const kind = isEventKind(event.kind) ? event.kind : "camp";
  const asked = new Set(
    formDays(
      eventDays.map((d) => ({ id: d.id, date: formatDateOnly(d.date) })),
      kind,
      todayDateOnly(),
    ).map((d) => d.id),
  );
  const days: OverviewDay[] = eventDays
    .filter((d) => asked.has(d.id) || answeredDays.has(d.id))
    .map((d) => ({
      id: d.id,
      date: formatDateOnly(d.date),
      food: food[d.id] ?? { coming: 0, withFood: 0, withoutFood: 0, unknown: 0 },
    }));

  const children: OverviewChild[] = regs.map((r) => ({
    id: r.id,
    name: r.participant?.name ?? r.childName ?? "",
    grade: r.participant?.grade ?? r.childGrade,
    status: r.status as RegistrationStatus,
    isNew: r.participantId === null,
    updated: r.revision > 1,
    needsReview:
      r.status !== "waitlist" &&
      (r.status === "pending" || (r.reviewReasons.length > 0 && r.reviewedAt === null)),
    comingDayIds: r.days.map((d) => d.eventDayId),
    note: r.note ? (withContacts ? r.note : hidePhones(r.note)) : null,
    parentName: withContacts ? (r.parentName ?? null) : null,
    parentPhone: withContacts ? (r.parentPhone ?? null) : null,
  }));

  const prev = previousEvent(
    others.map((e) => ({
      ...e,
      startDate: formatDateOnly(e.startDate),
      endDate: formatDateOnly(e.endDate),
    })),
    {
      id: event.id,
      startDate: formatDateOnly(event.startDate),
      endDate: formatDateOnly(event.endDate),
    },
  );

  let previous: RegistrationOverviewData["previous"] = null;
  if (prev) {
    const [attended, rostered] = await Promise.all([
      prisma.eventAttendance.findMany({
        where: {
          eventDay: { eventId: prev.id },
          status: { in: ["present", "late"] },
          participant: { deletedAt: null },
        },
        distinct: ["participantId"],
        select: { participantId: true },
      }),
      prisma.participant.findMany({
        where: { deletedAt: null, events: { some: { id: prev.id } } },
        select: { id: true },
      }),
    ]);
    const basis = previousParticipants(
      attended.map((a) => a.participantId),
      rostered.map((p) => p.id),
    );
    const candidates = await prisma.participant.findMany({
      where: { id: { in: basis.ids }, deletedAt: null },
      select: { id: true, name: true, grade: true },
    });
    const answered = new Set(
      regs.map((r) => r.participantId).filter((id): id is string => id !== null),
    );
    previous = {
      name: prev.name,
      basis: basis.basis,
      notRegistered: notYetRegistered(candidates, answered),
    };
  }

  return { days, children, previous };
}
