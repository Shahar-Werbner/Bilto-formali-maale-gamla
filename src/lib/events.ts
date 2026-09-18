import { parseDateOnly, formatDateOnly } from "./attendance";

// JS getUTCDay(): Sunday=0 … Friday=5, Saturday=6. `weekday` below uses the
// same numbering, so a template row can be matched against a date directly.
const FRIDAY = 5;
const SATURDAY = 6;

// A "camp" runs on every day in its range (weekends excluded unless asked for);
// a "recurring" event runs only on the weekdays in its template. The operation
// this serves is mostly recurring — every Tuesday and Friday through the year —
// with camps in the holidays.
export const EVENT_KINDS = ["recurring", "camp"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isEventKind(value: unknown): value is EventKind {
  return (
    typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value)
  );
}

// A school year is ~300 days. Anything much past that is a typo in a date
// field, and generating from it writes thousands of rows before anyone notices.
export const MAX_EVENT_RANGE_DAYS = 400;

export type WeekdayTemplate = {
  weekday: number; // 0=Sunday … 6=Saturday
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
};

export type GeneratedDay = {
  date: string; // "YYYY-MM-DD"
  startTime: string | null;
  endTime: string | null;
};

export type GenerateEventDaysInput = {
  startDate: string;
  endDate: string;
  kind: EventKind;
  // recurring only
  weekdays?: WeekdayTemplate[];
  // camp only
  includeFriday?: boolean;
  includeSaturday?: boolean;
  defaultStartTime?: string | null;
  defaultEndTime?: string | null;
};

// ── Times ───────────────────────────────────────────────────────────────────
// Times are "HH:mm" strings, like ActivitySlot already stores them. They are
// wall-clock within a calendar day, so there is no timezone to get wrong.

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

function minutesOfDay(value: unknown): number | null {
  if (!isTimeOfDay(value)) return null;
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}

// Length of a session in hours, for the staff-hours report that will be built
// on top of this. Returns 0 — never a negative or a NaN — for a missing,
// malformed or inverted pair, so one bad row cannot quietly inflate or deflate
// somebody's month.
export function hoursBetween(
  startTime?: string | null,
  endTime?: string | null,
): number {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  if (start === null || end === null) return 0;
  if (end <= start) return 0;
  return Math.round(((end - start) / 60) * 100) / 100;
}

// ── Day generation ──────────────────────────────────────────────────────────

// Number of calendar days in [start, end] inclusive, or null when the range is
// invalid or inverted. Callers use it to reject an over-long range with a
// message that says so, rather than the generic "no days in range".
export function rangeDayCount(startStr: string, endStr: string): number | null {
  const start = parseDateOnly(startStr);
  const end = parseDateOnly(endStr);
  if (!start || !end || start.getTime() > end.getTime()) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

// Every calendar day the event should have, with the hours that day runs.
//
// - recurring → only the weekdays in the template, each with its own hours.
//   No weekdays means no days: an empty template is an unfinished form, not
//   "every day of the year".
// - camp → every day in the range, skipping Friday/Saturday unless included,
//   all with the event's default hours.
//
// Over MAX_EVENT_RANGE_DAYS the range is refused outright (empty list) rather
// than truncated, so a mistyped year cannot half-create an event.
export function generateEventDays(input: GenerateEventDaysInput): GeneratedDay[] {
  const span = rangeDayCount(input.startDate, input.endDate);
  if (span === null || span > MAX_EVENT_RANGE_DAYS) return [];

  const start = parseDateOnly(input.startDate)!;
  const end = parseDateOnly(input.endDate)!;

  const byWeekday = new Map<number, WeekdayTemplate>();
  if (input.kind === "recurring") {
    for (const w of input.weekdays ?? []) {
      if (!Number.isInteger(w.weekday) || w.weekday < 0 || w.weekday > 6) continue;
      if (!isTimeOfDay(w.startTime) || !isTimeOfDay(w.endTime)) continue;
      // First entry wins; the API rejects duplicates before reaching here.
      if (!byWeekday.has(w.weekday)) byWeekday.set(w.weekday, w);
    }
    if (byWeekday.size === 0) return [];
  }

  const defaultStartTime = isTimeOfDay(input.defaultStartTime)
    ? input.defaultStartTime
    : null;
  const defaultEndTime = isTimeOfDay(input.defaultEndTime)
    ? input.defaultEndTime
    : null;

  const days: GeneratedDay[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const weekday = cursor.getUTCDay();

    if (input.kind === "recurring") {
      const template = byWeekday.get(weekday);
      if (template) {
        days.push({
          date: formatDateOnly(cursor),
          startTime: template.startTime,
          endTime: template.endTime,
        });
      }
    } else {
      const skip =
        (weekday === FRIDAY && input.includeFriday !== true) ||
        (weekday === SATURDAY && input.includeSaturday !== true);
      if (!skip) {
        days.push({
          date: formatDateOnly(cursor),
          startTime: defaultStartTime,
          endTime: defaultEndTime,
        });
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// ── Display ─────────────────────────────────────────────────────────────────

export const WEEKDAY_NAMES = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

export function formatHebrewDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString("he-IL", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

// "16:00–19:00" for the day header. Empty string when the day has no hours,
// so the caller can drop the line entirely instead of printing a dash.
export function formatTimeRange(
  startTime?: string | null,
  endTime?: string | null,
): string {
  if (!isTimeOfDay(startTime) || !isTimeOfDay(endTime)) return "";
  return `${startTime}–${endTime}`;
}
