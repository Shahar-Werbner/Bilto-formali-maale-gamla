// The monthly hours report (item 6).
//
// This is almost entirely a derivation, not new data: item 1 put hours on every
// session (`EventDay.startTime/endTime`) and item 4 put people on sessions
// (`Shift`), and a month of work is the sum of the two. Nothing here is typed
// in by hand — the spec's rule is that **only exceptions are typed**, so
// somebody who worked the whole session touches nothing and still appears with
// the right number.
//
// Kept free of Prisma and NextAuth so a month can be summed and checked
// directly, the way shifts.ts and attendance.ts are.

import { formatDateOnly, parseDateOnly, todayDateOnly } from "./attendance";
import { effectiveHours } from "./shifts";

// ── The month itself ────────────────────────────────────────────────────────
//
// A month is a "YYYY-MM" string for the same reason a day is "YYYY-MM-DD"
// (invariant 4): it is a calendar month, not an instant, and the moment it
// becomes a Date somebody's September starts on the 31st of August.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

/**
 * The month we are in now, in Asia/Jerusalem.
 *
 * Derived from `todayDateOnly()` rather than from the server's UTC clock: the
 * server runs in UTC, so between midnight and 02:00 local on the 1st, a UTC
 * clock still says last month — and the report would open on the wrong one
 * exactly when somebody is closing the previous month's hours.
 */
export function currentMonth(now: Date = new Date()): string {
  return todayDateOnly(now).slice(0, 7);
}

export type MonthRange = { start: string; end: string };

/** The first and last calendar day of a month, inclusive. */
export function monthRange(month: string): MonthRange | null {
  if (!isMonth(month)) return null;
  const start = parseDateOnly(`${month}-01`);
  if (!start) return null;
  // Day 0 of the next month is the last day of this one, which spares us a
  // leap-year table.
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  );
  return { start: formatDateOnly(start), end: formatDateOnly(end) };
}

/** The month before this one — what the "previous" arrow moves to. */
export function shiftMonth(month: string, delta: number): string {
  const range = monthRange(month);
  if (!range) return month;
  const start = parseDateOnly(range.start)!;
  const moved = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + delta, 1),
  );
  return formatDateOnly(moved).slice(0, 7);
}

/** "ספטמבר 2026" for a heading. */
export function monthLabel(month: string): string {
  if (!isMonth(month)) return month;
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ── Summing a month ─────────────────────────────────────────────────────────

/** One shift, with the session it belongs to, flattened out of Prisma. */
export type HoursRow = {
  userId: string;
  userName: string;
  userRole: string;
  date: string; // "YYYY-MM-DD"
  eventName: string;
  /** The session's hours — what a shift with no times of its own falls back to. */
  dayStartTime: string | null;
  dayEndTime: string | null;
  /** The shift's own hours, when somebody typed an exception. */
  startTime: string | null;
  endTime: string | null;
  role: string | null;
  note: string | null;
};

export type HoursDay = {
  date: string;
  eventName: string;
  startTime: string | null;
  endTime: string | null;
  hours: number;
  /** Somebody typed hours for this shift instead of taking the session's. */
  overridden: boolean;
  role: string | null;
  note: string | null;
};

export type HoursPerson = {
  userId: string;
  name: string;
  userRole: string;
  /** Rounded once, at the end — see totalHours below. */
  totalHours: number;
  /** Sessions worked, including any that could not be priced. */
  dayCount: number;
  /**
   * Days the person is rostered on that come out at zero hours, because
   * neither the shift nor the session says when it ran.
   *
   * Surfaced rather than dropped: a day silently worth nothing is somebody's
   * pay missing from a month, and the only screen that can catch it is this
   * one. It is also the one number here a person can act on — the hours go on
   * the session, or on the shift as an exception.
   */
  missingHoursDays: number;
  days: HoursDay[];
};

/**
 * Hours are rounded to two decimals per shift (`hoursBetween`), and a month of
 * those summed in floating point drifts — 3.5 + 3.5 + 0.25 lands on
 * 7.249999999999999 often enough to print. Round once, at the total.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A month of shifts, per person, newest-first within each person.
 *
 * People are returned sorted by name so the list is stable between loads —
 * a payroll sheet that reorders itself every refresh is one nobody can check
 * a second time against the first.
 */
export function summarizeMonth(rows: readonly HoursRow[]): HoursPerson[] {
  const byUser = new Map<string, HoursPerson>();

  for (const row of rows) {
    const effective = effectiveHours(row, {
      startTime: row.dayStartTime,
      endTime: row.dayEndTime,
    });

    const person =
      byUser.get(row.userId) ??
      ({
        userId: row.userId,
        name: row.userName,
        userRole: row.userRole,
        totalHours: 0,
        dayCount: 0,
        missingHoursDays: 0,
        days: [],
      } satisfies HoursPerson);

    person.totalHours += effective.hours;
    person.dayCount += 1;
    if (effective.hours === 0) person.missingHoursDays += 1;
    person.days.push({
      date: row.date,
      eventName: row.eventName,
      startTime: effective.startTime,
      endTime: effective.endTime,
      hours: effective.hours,
      overridden: effective.overridden,
      role: row.role,
      note: row.note,
    });

    byUser.set(row.userId, person);
  }

  const people = [...byUser.values()];
  for (const person of people) {
    person.totalHours = round2(person.totalHours);
    person.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  return people.sort((a, b) => a.name.localeCompare(b.name, "he"));
}

/** The month's total across everyone, for the line above the table. */
export function totalHours(people: readonly HoursPerson[]): number {
  return round2(people.reduce((sum, p) => sum + p.totalHours, 0));
}

// ── Display ─────────────────────────────────────────────────────────────────

// Hebrew counts one and many differently, and these lines are read on a phone.
// No ratios with a colon and no `ל-<ספרה>` inside a Hebrew sentence: both come
// out reversed in RTL (the lesson item 4 stage B left behind).
export function hoursText(n: number): string {
  if (n === 1) return "שעה אחת";
  if (n === 2) return "שעתיים";
  return `${n} שעות`;
}

export function sessionsText(n: number): string {
  return n === 1 ? "מפגש אחד" : `${n} מפגשים`;
}

/**
 * The warning on a person whose month has sessions worth nothing, or null.
 *
 * Named in sessions rather than in hours because the missing hours are exactly
 * what nobody knows — "two sessions have no hours" is actionable, "0 hours" is
 * the symptom being explained.
 */
export function missingHoursAlert(person: HoursPerson): string | null {
  if (person.missingHoursDays === 0) return null;
  return person.missingHoursDays === 1
    ? "מפגש אחד בלי שעות — לא נספר בסיכום."
    : `${person.missingHoursDays} מפגשים בלי שעות — לא נספרו בסיכום.`;
}
