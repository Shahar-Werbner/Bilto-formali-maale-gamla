// Going home: the standing instruction for a child, who is allowed to collect
// them, and what actually happened at the end of one session.
//
// Kept free of Prisma and NextAuth imports so the rule that matters — which
// dismissals a youth counselor may record on their own — can be unit-tested
// directly, the same way attendance statuses are.

import { normalizeName, normalizePhone } from "@/lib/participants";

export const DISMISSAL_METHODS = ["alone", "escort"] as const;
export type DismissalMethod = (typeof DISMISSAL_METHODS)[number];

export function isDismissalMethod(value: unknown): value is DismissalMethod {
  return (
    typeof value === "string" &&
    (DISMISSAL_METHODS as readonly string[]).includes(value)
  );
}

// The children are 6-9. A child with no explicit instruction waits for an
// adult; we never assume they walk home. The column default is "escort" for
// the same reason, so a row created by any path lands on the safe side.
export const DEFAULT_DISMISSAL: DismissalMethod = "escort";

export function dismissalMethodOf(value: unknown): DismissalMethod {
  return isDismissalMethod(value) ? value : DEFAULT_DISMISSAL;
}

export const DISMISSAL_METHOD_LABEL: Record<DismissalMethod, string> = {
  alone: "הולך/ת לבד",
  escort: "מחכה למבוגר",
};

/** What a child's row on the dismissal screen is showing right now. */
export type DismissalState = "waiting" | "alone" | "collected";

export type DismissalRecord = {
  method: DismissalMethod;
  pickedUpByName?: string | null;
} | null;

// Three states, and the difference between the last two is the whole point of
// the screen: "went home alone" and "collected by X" are both done, "waiting"
// is not. A child with no row yet is waiting — including a child whose standing
// instruction is "alone", because nobody has confirmed they actually left.
export function dismissalState(record: DismissalRecord): DismissalState {
  if (!record) return "waiting";
  return record.method === "alone" ? "alone" : "collected";
}

export const DISMISSAL_STATE_LABEL: Record<DismissalState, string> = {
  waiting: "מחכה",
  alone: "יצא/ה לבד",
  collected: "נאסף/ה",
};

export type Authorization = { name: string };

/** Is this the name of someone on the child's standing pickup list? */
export function isAuthorizedName(
  name: string,
  authorizations: readonly Authorization[],
): boolean {
  const wanted = normalizeName(name);
  if (!wanted) return false;
  return authorizations.some((a) => normalizeName(a.name) === wanted);
}

export type DismissalInput = {
  method: DismissalMethod;
  pickedUpByName?: string | null;
  note?: string | null;
};

export type DismissalContext = {
  /** The child's standing instruction (Participant.defaultDismissal). */
  defaultDismissal: DismissalMethod;
  /** Who is on their pickup list. */
  authorizations: readonly Authorization[];
};

// ── The gate ────────────────────────────────────────────────────────────────
//
// Decided by the project owner, 19.09: a youth counselor may record a dismissal
// that matches the pickup list. Anything that departs from it needs an adult.
//
// Why the gate sits here and not on every dismissal: most of the team are youth
// counselors. Requiring an adult for *every* child at the end of the day means
// the rule is worked around by the end of the first session, and a rule that is
// worked around is worse than no rule. So the gate sits on the dangerous case
// only — someone not on the list arriving for a six-year-old — and routine
// dismissals stay in the hands of the person actually standing at the gate.
//
// Three kinds of departure, each a real one:
//   1. A name that is not on the child's list.
//   2. Sending a child home alone when their standing instruction says escort.
//      This is a one-off change to the instruction, and it is the change with
//      the worst failure mode of the three.
//   3. A free-text one-off note ("today grandma") — by definition a change to
//      the standing arrangement, which is exactly what the note field is for.
export function isDismissalException(
  input: DismissalInput,
  context: DismissalContext,
): boolean {
  if (input.note && input.note.trim()) return true;

  if (input.method === "alone") {
    return context.defaultDismissal !== "alone";
  }

  const collectedBy = (input.pickedUpByName ?? "").trim();
  if (!collectedBy) return true; // "collected" with nobody named is not a match
  return !isAuthorizedName(collectedBy, context.authorizations);
}

// The reason shown to a youth counselor who hits the gate. The screen says what
// is needed and by whom rather than failing a button: "an adult has to confirm
// this" is something a 15-year-old can act on; a red error is not.
export function dismissalExceptionReason(
  input: DismissalInput,
  context: DismissalContext,
): string | null {
  if (!isDismissalException(input, context)) return null;
  if (input.note && input.note.trim()) {
    return "שינוי חד-פעמי מחייב אישור של מדריך/ה בוגר/ת";
  }
  if (input.method === "alone") {
    return "ההוראה הקבועה היא שהילד/ה מחכה למבוגר — שחרור לבד מחייב מדריך/ה בוגר/ת";
  }
  if (!(input.pickedUpByName ?? "").trim()) {
    return "צריך לרשום מי אסף/ה את הילד/ה";
  }
  return "השם אינו ברשימת מורשי האיסוף — מחייב אישור של מדריך/ה בוגר/ת";
}

// ── Merging two records of one child ────────────────────────────────────────
//
// When a duplicate child record is folded into the surviving one, their pickup
// lists have to be folded too — a survivor showing an empty list reads exactly
// like "nobody is allowed to take this child home".
//
// Matching them on name *and* phone was too strict, and the failure was visible
// the first time it ran against real data: the same mother entered once with a
// number and once without produced two identical rows on the survivor, which is
// the mess the deduplication exists to prevent.
//
// The rule below, in the order the two mistakes matter:
//   - Never drop someone the survivor does not already have. Narrowing who may
//     collect a child is the dangerous direction, so anything uncertain moves.
//   - Two rows are the same person when the names match and the phones do not
//     contradict each other: one side missing a number is the ordinary case of
//     a hurried entry, not a second person.
//   - Two matching names with two *different* numbers are left as two rows.
//     They may be one person with a new number or genuinely two people, and
//     that is for an adult to look at — merging them would silently discard a
//     phone number that someone deliberately typed.
export type MergeableAuthorization = { name: string; phone?: string | null };

function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return normalizePhone(phone);
}

export function isSameAuthorization(
  a: MergeableAuthorization,
  b: MergeableAuthorization,
): boolean {
  if (normalizeName(a.name) !== normalizeName(b.name)) return false;
  const [pa, pb] = [phoneKey(a.phone), phoneKey(b.phone)];
  if (pa === null || pb === null) return true;
  return pa === pb;
}

/** Which of the duplicate's authorizations to move across, and which to drop. */
export function splitAuthorizationsForMerge<T extends MergeableAuthorization>(
  incoming: readonly T[],
  existing: readonly MergeableAuthorization[],
): { move: T[]; drop: T[] } {
  const taken: MergeableAuthorization[] = [...existing];
  const move: T[] = [];
  const drop: T[] = [];

  for (const row of incoming) {
    if (taken.some((t) => isSameAuthorization(t, row))) {
      drop.push(row);
    } else {
      // A repeat inside the incoming list itself collides just as hard.
      taken.push(row);
      move.push(row);
    }
  }
  return { move, drop };
}
