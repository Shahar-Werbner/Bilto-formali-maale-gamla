// The activity bank (wave 3, item 7).
//
// Youth counselors rotate every year or two, and what they learned about which
// activity holds a group of 7-year-olds goes with them. The bank keeps it: an
// activity is written once, picked into a day's schedule, and rated after it
// ran. The rating is what closes the loop — a year in, the bank is ordered by
// what actually worked here, not by what someone once thought would.
//
// Everything that decides something lives here, free of Prisma and NextAuth,
// so it can be read in one place and tested directly.

import { gradeRank } from "@/lib/attendance";

// ── Verdicts ────────────────────────────────────────────────────────────────

export const VERDICTS = ["worked", "flopped", "wrong_age"] as const;
export type Verdict = (typeof VERDICTS)[number];

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  worked: "עבד",
  flopped: "לא עבד",
  wrong_age: "לא מתאים לגיל",
};

export const VERDICT_ICON: Record<Verdict, string> = {
  worked: "👍",
  flopped: "👎",
  wrong_age: "🎯",
};

export type RatingSummary = {
  worked: number;
  flopped: number;
  wrongAge: number;
  total: number;
  /**
   * How likely this activity is to work, 0–1, for ordering the bank.
   *
   * (worked + 1) / (total + 2) — the share that worked, pulled toward one half
   * by one imaginary vote each way. Without the pull, an activity rated once
   * and liked (1/1 = 100%) would sit above one that worked eleven times out of
   * twelve, and the top of the list would be whatever was tried once. An
   * unrated activity scores exactly 0.5: above anything that mostly failed,
   * below anything that has proven itself.
   *
   * "wrong age" counts against it: for a bank of activities for grades א–ג,
   * an activity that does not fit them did not work here, whatever the reason.
   */
  score: number;
};

export function summarizeRatings(
  verdicts: readonly { verdict: unknown }[],
): RatingSummary {
  let worked = 0;
  let flopped = 0;
  let wrongAge = 0;
  for (const { verdict } of verdicts) {
    // An unknown verdict string is ignored rather than counted as anything —
    // counting it as "worked" would be the unsafe direction for a ranking.
    if (verdict === "worked") worked++;
    else if (verdict === "flopped") flopped++;
    else if (verdict === "wrong_age") wrongAge++;
  }
  const total = worked + flopped + wrongAge;
  return { worked, flopped, wrongAge, total, score: (worked + 1) / (total + 2) };
}

/** Best first; ties go to the one tried more often, then by name. */
export function rankActivities<T extends { name: string; summary: RatingSummary }>(
  list: readonly T[],
): T[] {
  return [...list].sort(
    (a, b) =>
      b.summary.score - a.summary.score ||
      b.summary.total - a.summary.total ||
      a.name.localeCompare(b.name, "he"),
  );
}

// ── Grades ──────────────────────────────────────────────────────────────────

// The grades an activity can be tagged with. The operation is א–ג today, but
// the range is a property of the activity, not of this year's roster.
export const GRADE_CHOICES = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'"] as const;

function knownGrade(grade: string | null | undefined): boolean {
  return !!grade && gradeRank(grade) < 12;
}

/**
 * Does an activity suit a child in this grade? An open end is open: no
 * minGrade means "from the youngest". A child with no grade recorded fits
 * everything — the filter is there to hide what is clearly wrong, not to hide
 * the bank from a roster that has not been filled in yet.
 */
export function fitsGrade(
  activity: { minGrade?: string | null; maxGrade?: string | null },
  grade: string | null | undefined,
): boolean {
  if (!knownGrade(grade)) return true;
  const g = gradeRank(grade);
  if (knownGrade(activity.minGrade) && g < gradeRank(activity.minGrade)) return false;
  if (knownGrade(activity.maxGrade) && g > gradeRank(activity.maxGrade)) return false;
  return true;
}

export function gradeRangeLabel(
  minGrade?: string | null,
  maxGrade?: string | null,
): string | null {
  if (minGrade && maxGrade) {
    return minGrade === maxGrade ? `כיתה ${minGrade}` : `כיתות ${minGrade}–${maxGrade}`;
  }
  if (minGrade) return `מכיתה ${minGrade}`;
  if (maxGrade) return `עד כיתה ${maxGrade}`;
  return null;
}

// ── Input ───────────────────────────────────────────────────────────────────

export const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 24;
const MAX_NAME = 120;
const MAX_TEXT = 2000;
export const MAX_DURATION_MINUTES = 8 * 60;

export type ActivityInput = {
  name: string;
  description: string | null;
  durationMinutes: number | null;
  materials: string | null;
  tags: string[];
  minGrade: string | null;
  maxGrade: string | null;
};

/**
 * Tags arrive as an array or as a comma-separated string (which is what a
 * phone keyboard produces). Trimmed, de-duplicated, capped — a tag is a
 * filter chip, and a chip row of forty near-duplicates filters nothing.
 */
export function cleanTags(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,،\n]/)
      : [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

// Strict, unlike gradeRank(), which is built to *sort* whatever a roster
// holds and so reads "גן" as ג. An activity's range is chosen from a fixed
// list; anything else is refused and a known grade is stored in one spelling
// ("ב" and "ב׳" both become "ב'"), so the bank's filter compares like with like.
function grade(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const letters = value.replace(/[^א-ת]/g, "");
  const match = GRADE_CHOICES.find((g) => g.replace(/[^א-ת]/g, "") === letters);
  return match ?? "invalid";
}

/**
 * Validates a whole activity (create), or the fields present in it (patch).
 * Returns the error to show, or the cleaned fields.
 */
export function parseActivityInput(
  body: unknown,
  { partial = false }: { partial?: boolean } = {},
): { error: string } | { data: Partial<ActivityInput> } {
  const b = (body ?? {}) as Record<string, unknown>;
  const data: Partial<ActivityInput> = {};
  const has = (k: string) => !partial || b[k] !== undefined;

  if (has("name")) {
    const name = text(b.name, MAX_NAME);
    if (!name) return { error: "יש לכתוב שם לפעילות" };
    data.name = name;
  }
  if (has("description")) data.description = text(b.description, MAX_TEXT);
  if (has("materials")) data.materials = text(b.materials, MAX_TEXT);
  if (has("tags")) data.tags = cleanTags(b.tags);

  if (has("durationMinutes")) {
    const v = b.durationMinutes;
    if (v === undefined || v === null || v === "") {
      data.durationMinutes = null;
    } else {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < 1 || n > MAX_DURATION_MINUTES) {
        return { error: "משך הפעילות צריך להיות מספר דקות בין 1 ל-480" };
      }
      data.durationMinutes = n;
    }
  }

  if (has("minGrade")) {
    const g = grade(b.minGrade);
    if (g === "invalid") return { error: "כיתה לא מוכרת" };
    data.minGrade = g;
  }
  if (has("maxGrade")) {
    const g = grade(b.maxGrade);
    if (g === "invalid") return { error: "כיתה לא מוכרת" };
    data.maxGrade = g;
  }
  return { data };
}

/** A reversed range ("from ג' to א'") matches no child at all. */
export function gradeRangeError(
  minGrade: string | null | undefined,
  maxGrade: string | null | undefined,
): string | null {
  if (minGrade && maxGrade && gradeRank(minGrade) > gradeRank(maxGrade)) {
    return "טווח הכיתות הפוך — מכיתה גבוהה לנמוכה";
  }
  return null;
}

// ── Picking into a schedule ─────────────────────────────────────────────────

/** "10:00" + 45 minutes → "10:45". Null past midnight rather than wrapping. */
export function endTimeFrom(start: string, minutes: number | null | undefined): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(start);
  if (!m || !minutes || minutes <= 0) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ── Rating ──────────────────────────────────────────────────────────────────

/**
 * Why this slot cannot be rated, or null if it can.
 *
 * A rating is a claim that the activity ran. So: it has to come from the bank
 * (there is nothing to attach the verdict to otherwise), it has to have been
 * part of the day (a proposal nobody approved may never have happened), and
 * the day has to have arrived. Both dates are calendar days ("YYYY-MM-DD");
 * `today` must come from todayDateOnly(), in Israel time.
 */
export function rateBlockReason({
  activityId,
  status,
  date,
  today,
}: {
  activityId: string | null | undefined;
  status: unknown;
  date: string;
  today: string;
}): string | null {
  if (!activityId) return "הפעילות לא מהמאגר, ואין למה לצרף את הדירוג";
  if (status !== "approved") return "אפשר לדרג רק פעילות שאושרה והתקיימה";
  if (date > today) return "אפשר לדרג רק אחרי שהפעילות התקיימה";
  return null;
}

// ── The AI's view of the bank ───────────────────────────────────────────────

// Enough of the bank for the model to choose from without drowning the
// prompt: the best-rated first, and a hard cap. A bank of a few hundred
// entries does not need to be sent whole to fill two gaps in a Tuesday.
export const AI_BANK_LIMIT = 60;

export function bankForPrompt(
  list: readonly {
    name: string;
    durationMinutes: number | null;
    tags: string[];
    minGrade: string | null;
    maxGrade: string | null;
    summary: RatingSummary;
  }[],
): string[] {
  return rankActivities(list)
    .slice(0, AI_BANK_LIMIT)
    .map((a) => {
      const bits = [
        a.durationMinutes ? `${a.durationMinutes} דק'` : "",
        a.tags.length ? a.tags.join("/") : "",
        gradeRangeLabel(a.minGrade, a.maxGrade) ?? "",
        a.summary.total
          ? `עבד ${a.summary.worked}/${a.summary.total}`
          : "עוד לא דורג",
      ].filter(Boolean);
      return `- ${a.name} (${bits.join(", ")})`;
    });
}

/** Match a name the model returned to a bank entry, forgiving case and spaces. */
export function matchActivityByName<T extends { name: string }>(
  list: readonly T[],
  name: string | null | undefined,
): T | undefined {
  if (!name) return undefined;
  const key = normalizeActivityName(name);
  if (!key) return undefined;
  return list.find((a) => normalizeActivityName(a.name) === key);
}

export function normalizeActivityName(name: string): string {
  return name.trim().replace(/\s+/g, " ").replace(/["'״׳]/g, "").toLowerCase();
}
