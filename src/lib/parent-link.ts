// Resolving a parent's link into "which child, and may this link still write".
//
// Server-only (it reaches Prisma), and separate from src/lib/parents.ts so the
// pure rules there stay importable from the browser. It lives in one place
// because the parent's page and the parent's API route must agree exactly: two
// copies of "is this link still good" is one copy that stops being updated.

import { prisma } from "@/lib/prisma";
import { isParentToken } from "@/lib/parents";
import { parseDateOnly, todayDateOnly } from "@/lib/attendance";
import { LIVE_EVENT } from "@/lib/event-scope";

export type ParentLinkResolution =
  | { ok: true; linkId: string; label: string | null; participant: ParentChild }
  // Told apart on purpose: a revoked link is a message the family can act on
  // ("ask the staff for a new one"), and confirming that a token they already
  // hold used to be valid tells them nothing they did not know. An unknown
  // token gets nothing.
  | { ok: false; reason: "unknown" | "revoked" };

export type ParentChild = {
  id: string;
  name: string;
  grade: string | null;
};

/**
 * The link a parent opened, or why it does not work.
 *
 * A soft-deleted child answers "unknown" rather than "revoked": the link was
 * never turned off, but the record behind it is gone from every other screen
 * too, and invariant 1 does not have an exception for the one screen a parent
 * sees.
 */
export async function resolveParentLink(
  token: unknown,
): Promise<ParentLinkResolution> {
  // Shape first, so a junk token is rejected without touching the database —
  // this endpoint is open, and the cheapest refusal is the one that costs no
  // query.
  if (!isParentToken(token)) return { ok: false, reason: "unknown" };

  const link = await prisma.parentLink.findUnique({
    where: { token },
    select: {
      id: true,
      label: true,
      revokedAt: true,
      participant: {
        select: { id: true, name: true, grade: true, deletedAt: true },
      },
    },
  });

  if (!link || link.participant.deletedAt) return { ok: false, reason: "unknown" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };

  return {
    ok: true,
    linkId: link.id,
    label: link.label,
    participant: {
      id: link.participant.id,
      name: link.participant.name,
      grade: link.participant.grade,
    },
  };
}

/** Somebody opened the link. Without this, "never answered" and "never got the link" look alike. */
export async function touchParentLink(linkId: string): Promise<void> {
  // Deliberately swallowed: this is bookkeeping, and a family must not be shown
  // an error because a timestamp failed to write.
  await prisma.parentLink
    .update({ where: { id: linkId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

export type ParentDay = {
  id: string;
  date: string; // "YYYY-MM-DD"
  eventName: string;
  startTime: string | null;
  endTime: string | null;
  coming: boolean | null;
  note: string | null;
};

// How far ahead a parent is asked about. Four sessions is a fortnight of
// Tuesdays and Fridays — far enough to answer before a holiday, short enough
// that the page is a short list on a phone rather than a year of scrolling.
export const PARENT_DAYS_AHEAD = 4;

/**
 * The sessions this child is on from today onwards, with whatever the family
 * already said about each.
 *
 * Today is included: "he is not coming today" is the message this whole item
 * exists to carry, and it is sent at 07:00 on the day.
 */
export async function parentDays(
  participantId: string,
  today: string = todayDateOnly(),
): Promise<ParentDay[]> {
  const from = parseDateOnly(today);
  if (!from) return [];

  const days = await prisma.eventDay.findMany({
    where: {
      date: { gte: from },
      event: {
        ...LIVE_EVENT,
        participants: { some: { id: participantId, deletedAt: null } },
      },
    },
    orderBy: { date: "asc" },
    take: PARENT_DAYS_AHEAD,
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      event: { select: { name: true } },
      expected: {
        where: { participantId },
        select: { coming: true, note: true },
      },
    },
  });

  return days.map((d) => ({
    id: d.id,
    date: d.date.toISOString().slice(0, 10),
    eventName: d.event.name,
    startTime: d.startTime,
    endTime: d.endTime,
    coming: d.expected[0]?.coming ?? null,
    note: d.expected[0]?.note ?? null,
  }));
}

/**
 * Is this day one this child is actually on, and still live?
 *
 * The check a write has to make: the day id arrives in a request body from an
 * open endpoint, so holding a link for one child must not be a way to write a
 * row for a day that child is not on.
 */
export async function parentMayWriteDay(
  participantId: string,
  eventDayId: string,
): Promise<boolean> {
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
  return Boolean(day);
}
