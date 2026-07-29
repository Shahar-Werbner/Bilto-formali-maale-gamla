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
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayDateOnly(): string {
  return formatDateOnly(new Date());
}
