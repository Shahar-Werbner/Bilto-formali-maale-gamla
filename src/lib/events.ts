import { parseDateOnly, formatDateOnly } from "./attendance";

// JS getUTCDay(): Sunday=0 … Friday=5, Saturday=6.
const FRIDAY = 5;
const SATURDAY = 6;

// Every calendar day in [start, end] (inclusive) that should have attendance.
// Fridays/Saturdays are excluded unless explicitly included. Returns
// "YYYY-MM-DD" strings. Caps at 366 days as a safety guard.
export function generateEventDates(
  startStr: string,
  endStr: string,
  includeFriday: boolean,
  includeSaturday: boolean,
): string[] {
  const start = parseDateOnly(startStr);
  const end = parseDateOnly(endStr);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 366) {
    const day = cursor.getUTCDay();
    const skip =
      (day === FRIDAY && !includeFriday) ||
      (day === SATURDAY && !includeSaturday);
    if (!skip) dates.push(formatDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard++;
  }
  return dates;
}

export function formatHebrewDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString("he-IL", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}
