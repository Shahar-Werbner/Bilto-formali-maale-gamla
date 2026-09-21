// Who is working a session, and whether that is enough people (item 4).
//
// Two calculations, both free of Prisma and NextAuth so they can be read and
// tested directly: the hours a shift is worth, and the staffing ratio the
// day's screen warns on.

import { hoursBetween, isTimeOfDay } from "./events";

// ── Hours ───────────────────────────────────────────────────────────────────

export type ShiftTimes = {
  startTime?: string | null;
  endTime?: string | null;
};

export type EffectiveHours = {
  startTime: string | null;
  endTime: string | null;
  hours: number;
  /** The shift says something other than "the session's hours". */
  overridden: boolean;
};

/**
 * The hours a shift is actually worth.
 *
 * null on the shift means "the session's hours" rather than "no hours": almost
 * every shift is the whole session, and storing the day's times on each row
 * would leave them stale the moment the session's hours are corrected. A value
 * on the shift wins — someone who left early, or a counselor who came only for
 * the second half, is exactly what the column is for.
 *
 * Each end is resolved on its own, so "came an hour late" is one field, not a
 * pair somebody has to retype.
 */
export function effectiveHours(shift: ShiftTimes, day: ShiftTimes): EffectiveHours {
  const startTime = shift.startTime ?? day.startTime ?? null;
  const endTime = shift.endTime ?? day.endTime ?? null;
  return {
    startTime,
    endTime,
    // hoursBetween answers 0 for a missing, malformed or inverted pair, so one
    // bad row cannot inflate or deflate somebody's month (item 6 reads this).
    hours: hoursBetween(startTime, endTime),
    overridden: Boolean(shift.startTime) || Boolean(shift.endTime),
  };
}

export type ShiftInput = {
  startTime: string | null;
  endTime: string | null;
  role: string | null;
  note: string | null;
};

export type ShiftInputResult =
  | { ok: true; value: ShiftInput }
  | { ok: false; error: string };

/**
 * Parses the editable fields of a shift from a request body. An empty string
 * clears a field back to "the session's hours", which is how the form sends a
 * cleared time input.
 */
export function parseShiftInput(body: Record<string, unknown> | null): ShiftInputResult {
  const startTime = optionalTime(body?.startTime);
  const endTime = optionalTime(body?.endTime);
  if (!startTime.ok || !endTime.ok) {
    return { ok: false, error: "שעה לא תקינה (פורמט HH:mm)" };
  }
  if (
    startTime.value &&
    endTime.value &&
    endTime.value <= startTime.value // "HH:mm" compares correctly — zero-padded
  ) {
    return { ok: false, error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה" };
  }
  return {
    ok: true,
    value: {
      startTime: startTime.value,
      endTime: endTime.value,
      role: optionalText(body?.role, 40),
      note: optionalText(body?.note, 200),
    },
  };
}

function optionalTime(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  if (!isTimeOfDay(value)) return { ok: false };
  return { ok: true, value };
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// ── The ratio alert ─────────────────────────────────────────────────────────

// How many children one counselor may cover before a session counts as
// short-staffed, when the event says nothing. Eight is a starting point for
// 6–9-year-olds in informal education, not a regulation: it is per-event
// (`Event.maxChildrenPerStaff`) precisely because a craft afternoon and a trip
// are not the same question. The project owner should set the real number.
export const DEFAULT_MAX_CHILDREN_PER_STAFF = 8;

export type StaffingInput = {
  /** Children on the event — the most children that can turn up. */
  rosteredChildren: number;
  /** Present + late, but only once the day is fully marked. See below. */
  markedChildren: number | null;
  /** Everyone assigned to the day, youth counselors included. */
  staffCount: number;
  /** Of those, the adults (staff or admin). */
  adultCount: number;
  /** The event's threshold, or null to use the app-wide default. */
  maxChildrenPerStaff: number | null;
};

export type Staffing = {
  children: number;
  childrenSource: "roster" | "marked";
  staffCount: number;
  adultCount: number;
  threshold: number;
  /** Children per counselor, to one decimal. 0 when nobody is assigned. */
  perStaff: number;
  /** How many more counselors the threshold asks for. */
  missingStaff: number;
  /** "none" = nobody is assigned at all, which is its own kind of wrong. */
  level: "ok" | "short" | "none";
  /** Somebody is assigned, but not one of them is an adult. */
  noAdult: boolean;
};

/**
 * The daily question — "who is coming on Tuesday, and are we short?" — as a
 * number the day's screen can warn on.
 *
 * Which child count to use is the one real decision here. A fully marked day
 * has a true number, so it is used. A partly marked day does not: five marked
 * of fifty would read as "five children, plenty of staff" halfway through the
 * morning, which is the alert failing in the dangerous direction. So anything
 * short of fully marked falls back to the roster — the most children that can
 * turn up. It over-warns before a session, and over-warning about staffing is
 * the side to be wrong on.
 */
export function staffing({
  rosteredChildren,
  markedChildren,
  staffCount,
  adultCount,
  maxChildrenPerStaff,
}: StaffingInput): Staffing {
  const threshold =
    maxChildrenPerStaff && maxChildrenPerStaff > 0
      ? maxChildrenPerStaff
      : DEFAULT_MAX_CHILDREN_PER_STAFF;

  const children = markedChildren === null ? rosteredChildren : markedChildren;
  const needed = Math.ceil(children / threshold);
  const missingStaff = Math.max(0, needed - staffCount);

  return {
    children,
    childrenSource: markedChildren === null ? "roster" : "marked",
    staffCount,
    adultCount,
    threshold,
    perStaff:
      staffCount > 0 ? Math.round((children / staffCount) * 10) / 10 : 0,
    missingStaff,
    // A day with no children needs nobody, and must not shout about it.
    level:
      children === 0 ? "ok" : staffCount === 0 ? "none" : missingStaff > 0 ? "short" : "ok",
    // Most of the team are teenagers, so "four counselors" can mean four
    // 15-year-olds. That is a different sentence from "short-staffed" and gets
    // its own one.
    noAdult: children > 0 && staffCount > 0 && adultCount === 0,
  };
}

// Hebrew counts one and many differently, and these lines are read by
// teenagers on a phone: "חסרים 1 מדריכים" is the kind of wrong that makes an
// app feel like it was not written for you.
export function childrenText(n: number): string {
  return n === 1 ? "ילד/ה אחד/ת" : `${n} ילדים`;
}

export function staffText(n: number): string {
  return n === 1 ? "מדריך/ה אחד/ת" : `${n} מדריכים`;
}

/** The one-line summary the day's header shows. */
export function staffingLabel(s: Staffing): string {
  if (s.level === "none") return `${childrenText(s.children)} · אף אחד לא משובץ`;
  // Not "1:9.5": a ratio written with a colon comes out reversed and
  // unreadable inside an RTL line, which is where this is read.
  return `${childrenText(s.children)} · ${staffText(s.staffCount)} · ${s.perStaff} למדריך/ה`;
}

/**
 * The warning itself, or null when there is nothing to warn about.
 *
 * It names the shortfall in people rather than in ratio, because "two more" is
 * what somebody can act on at seven in the morning and "1:13.3" is not.
 */
export function staffingAlert(s: Staffing): string | null {
  if (s.level === "none") {
    return `אף מדריך/ה לא משובץ/ת ליום זה (${childrenText(s.children)}).`;
  }
  if (s.level === "short") {
    const missing =
      s.missingStaff === 1
        ? "חסר/ה מדריך/ה אחד/ת"
        : `חסרים ${s.missingStaff} מדריכים`;
    return `${missing} ליום זה: ${childrenText(s.children)}, ${staffText(
      s.staffCount,
    )}, והסף הוא ${childrenText(s.threshold)} למדריך/ה.`;
  }
  return null;
}
