import {
  MAX_EVENT_RANGE_DAYS,
  isEventKind,
  isTimeOfDay,
  rangeDayCount,
  type EventKind,
  type WeekdayTemplate,
} from "./events";

// Shared parsing for POST /api/events and PATCH /api/events/:id. Both accept
// the same schedule shape, and both have to reject the same bad input — an
// unfinished recurring template, an inverted pair of hours, a mistyped year —
// with a message the person on a phone can act on.

export type ScheduleInput = {
  kind: EventKind;
  includeFriday: boolean;
  includeSaturday: boolean;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  weekdays: WeekdayTemplate[];
};

export type ScheduleResult =
  | { ok: true; value: ScheduleInput }
  | { ok: false; error: string };

// Parses the schedule fields of a request body, falling back to `current` for
// anything the caller left out (PATCH sends partial bodies).
export function parseScheduleInput(
  body: Record<string, unknown> | null,
  current: ScheduleInput,
): ScheduleResult {
  let kind = current.kind;
  if (body?.kind !== undefined) {
    if (!isEventKind(body.kind)) {
      return { ok: false, error: "סוג אירוע לא תקין" };
    }
    kind = body.kind;
  }

  const includeFriday =
    body?.includeFriday === undefined
      ? current.includeFriday
      : body.includeFriday === true;
  const includeSaturday =
    body?.includeSaturday === undefined
      ? current.includeSaturday
      : body.includeSaturday === true;

  const start = parseOptionalTime(body?.defaultStartTime, current.defaultStartTime);
  const end = parseOptionalTime(body?.defaultEndTime, current.defaultEndTime);
  if (!start.ok || !end.ok) {
    return { ok: false, error: "שעה לא תקינה (פורמט HH:mm)" };
  }
  const defaultStartTime = start.value;
  const defaultEndTime = end.value;
  if (Boolean(defaultStartTime) !== Boolean(defaultEndTime)) {
    return { ok: false, error: "יש למלא גם שעת התחלה וגם שעת סיום" };
  }
  if (defaultStartTime && defaultEndTime && defaultEndTime <= defaultStartTime) {
    // "HH:mm" compares correctly as a string — both are zero-padded.
    return { ok: false, error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה" };
  }

  let weekdays = current.weekdays;
  if (body?.weekdays !== undefined) {
    const parsed = parseWeekdays(body.weekdays);
    if (!parsed.ok) return parsed;
    weekdays = parsed.value;
  }

  if (kind === "recurring" && weekdays.length === 0) {
    return {
      ok: false,
      error: "יש לבחור לפחות יום אחד בשבוע ולמלא את שעותיו",
    };
  }

  return {
    ok: true,
    value: {
      kind,
      includeFriday,
      includeSaturday,
      defaultStartTime,
      defaultEndTime,
      weekdays,
    },
  };
}

// Rejects a range that is invalid, inverted, or long enough that generating
// from it would write thousands of rows — almost always a mistyped year.
export function validateRange(
  startStr: string,
  endStr: string,
): { ok: true } | { ok: false; error: string; status: number } {
  const span = rangeDayCount(startStr, endStr);
  if (span === null) {
    return {
      ok: false,
      status: 400,
      error: "תאריך לא תקין או שתאריך ההתחלה מאוחר מתאריך הסיום",
    };
  }
  if (span > MAX_EVENT_RANGE_DAYS) {
    return {
      ok: false,
      status: 400,
      error: `הטווח ארוך מדי (${span} ימים). המקסימום הוא ${MAX_EVENT_RANGE_DAYS} ימים`,
    };
  }
  return { ok: true };
}

// undefined → keep what is stored; null or "" → clear it; anything else must
// be a valid "HH:mm".
function parseOptionalTime(
  value: unknown,
  fallback: string | null,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: fallback };
  if (value === null || value === "") return { ok: true, value: null };
  if (!isTimeOfDay(value)) return { ok: false };
  return { ok: true, value };
}

function parseWeekdays(
  value: unknown,
): { ok: true; value: WeekdayTemplate[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "ימי השבוע אינם בפורמט תקין" };
  }
  const seen = new Set<number>();
  const out: WeekdayTemplate[] = [];
  for (const raw of value) {
    const weekday = (raw as { weekday?: unknown })?.weekday;
    const startTime = (raw as { startTime?: unknown })?.startTime;
    const endTime = (raw as { endTime?: unknown })?.endTime;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, error: "יום בשבוע לא תקין" };
    }
    if (seen.has(weekday)) {
      return { ok: false, error: "אותו יום בשבוע נבחר פעמיים" };
    }
    if (!isTimeOfDay(startTime) || !isTimeOfDay(endTime)) {
      return { ok: false, error: "שעה לא תקינה (פורמט HH:mm)" };
    }
    if (endTime <= startTime) {
      return { ok: false, error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה" };
    }
    seen.add(weekday);
    out.push({ weekday, startTime, endTime });
  }
  out.sort((a, b) => a.weekday - b.weekday);
  return { ok: true, value: out };
}
