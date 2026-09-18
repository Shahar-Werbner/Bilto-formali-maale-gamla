// Shared attendance domain constants & helpers.

export const STATUSES = ["present", "late", "absent"] as const;
export type Status = (typeof STATUSES)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export const STATUS_LABEL: Record<Status, string> = {
  present: "נוכח",
  late: "איחור",
  absent: "נעדר",
};

// A `@db.Date` column stores a calendar day with no timezone. We normalise
// every date to midnight UTC so the same "YYYY-MM-DD" always maps to the same
// stored value regardless of the server's timezone.
export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Date rolls an impossible day over (2026-02-29 → 2026-03-01) instead of
  // failing, which would silently store a different day than was asked for.
  return d.toISOString().slice(0, 10) === value ? d : null;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The team is in Israel; the server runs in UTC. Deriving "today" from the raw
// UTC date makes the app show yesterday between midnight and 02:00/03:00 local
// time, so resolve the calendar day in the local timezone instead.
export const LOCAL_TIMEZONE = "Asia/Jerusalem";

export function todayDateOnly(now: Date = new Date()): string {
  // "en-CA" formats as YYYY-MM-DD, which is exactly our date-only shape.
  return now.toLocaleDateString("en-CA", { timeZone: LOCAL_TIMEZONE });
}

// ── Grade ordering (כיתה) ────────────────────────────────────────────────
// Grades are free text ("א'", "ה'2", "ב"). We rank by the Hebrew grade letter
// so lists sort א, ב, ג… automatically. Unknown/empty grades sort last.
const GRADE_ORDER = [
  "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י", "יא", "יב",
];

export function gradeRank(grade?: string | null): number {
  if (!grade) return 999;
  const letters = grade.replace(/[^א-ת]/g, ""); // keep Hebrew letters only
  if (!letters) return 998;
  const exact = GRADE_ORDER.indexOf(letters);
  if (exact >= 0) return exact;
  const two = GRADE_ORDER.indexOf(letters.slice(0, 2));
  if (two >= 0) return two;
  const one = GRADE_ORDER.indexOf(letters.slice(0, 1));
  return one >= 0 ? one : 997;
}

// Sort a copy by grade (א→ב→ג…), then alphabetically by name.
export function sortByGrade<T extends { name: string; grade?: string | null }>(
  list: T[],
): T[] {
  return [...list].sort(
    (a, b) =>
      gradeRank(a.grade) - gradeRank(b.grade) ||
      a.name.localeCompare(b.name, "he"),
  );
}
