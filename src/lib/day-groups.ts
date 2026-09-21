// Splitting a session into groups, for one day.
//
// Two kinds of grouping live side by side (the owner's decision, 19.09):
// the standing membership (`Participant ↔ Group`, "Yael is in the Lions this
// year") and what actually happened on one session (`DayGroupAssignment`).
// The truth for a given day is always the day's assignments. The standing
// membership is a default to fill a day *from*, never what a day displays:
// a session with no assignments means "not split yet", not "everyone is in
// their permanent group".
//
// The prefill rules are here, free of Prisma and NextAuth, because they are
// the part that decides where 40 children end up and the part worth testing
// directly.

import { gradeRank } from "@/lib/attendance";

export const PREFILL_SOURCES = ["standing", "previous", "grade"] as const;
export type PrefillSource = (typeof PREFILL_SOURCES)[number];

export function isPrefillSource(value: unknown): value is PrefillSource {
  return (
    typeof value === "string" &&
    (PREFILL_SOURCES as readonly string[]).includes(value)
  );
}

export const PREFILL_SOURCE_LABEL: Record<PrefillSource, string> = {
  standing: "לפי הקבוצות הקבועות",
  previous: "העתקה מהמפגש הקודם",
  grade: "חלוקה לפי כיתה",
};

export type PrefillGroup = { id: string; name: string };

export type PrefillChild = {
  participantId: string;
  grade?: string | null;
  /** What this day already says. A child who has one is never overwritten. */
  currentGroupId?: string | null;
  /** The standing membership — a child may be in several groups, or none. */
  standingGroupIds?: readonly string[];
  /** Where this child was on the previous session of the same event. */
  previousGroupId?: string | null;
};

export type PrefillResult = {
  /** What to write: children who had no group for this day and now do. */
  assignments: Array<{ participantId: string; groupId: string }>;
  /** Children the day already placed. Left exactly as they were. */
  kept: string[];
  /** Children this source could not place. They stay unassigned. */
  unmatched: string[];
};

// A group name that *is* a grade ("א׳", "כיתה ב"), for the by-grade split.
// Anything else ("האריות") has no grade and takes part in no matching.
function gradeKeyOf(text?: string | null): number | null {
  if (!text) return null;
  const rank = gradeRank(text);
  // gradeRank answers 997-999 for "not a grade I know"; a real grade is an
  // index into its table.
  return rank < 900 ? rank : null;
}

/**
 * Fill a day's split from one of three sources, without touching what is
 * already there.
 *
 * Prefill is meant to turn the weekly split into a correction of a few
 * children, so it only ever *adds*: a child the day already placed is kept,
 * whichever source is used and however many times the button is pressed. A
 * redo is "clear the day, then prefill", which is two deliberate acts rather
 * than one that silently discards the manual work.
 *
 * Anything ambiguous is left unassigned rather than guessed. An unassigned
 * child is visible on the screen as one line to fix; a wrongly assigned one
 * looks exactly like a decision someone made.
 */
export function prefillAssignments({
  source,
  children,
  groups,
}: {
  source: PrefillSource;
  children: readonly PrefillChild[];
  groups: readonly PrefillGroup[];
}): PrefillResult {
  const groupIds = new Set(groups.map((g) => g.id));

  // Grade → the single group that carries it. A grade that two groups claim
  // ("א׳ 1", "א׳ 2") matches neither: which of them a child belongs to is a
  // decision, not a lookup.
  const byGrade = new Map<number, string | null>();
  if (source === "grade") {
    for (const g of groups) {
      const key = gradeKeyOf(g.name);
      if (key === null) continue;
      byGrade.set(key, byGrade.has(key) ? null : g.id);
    }
  }

  const result: PrefillResult = { assignments: [], kept: [], unmatched: [] };

  for (const child of children) {
    if (child.currentGroupId) {
      result.kept.push(child.participantId);
      continue;
    }

    let groupId: string | null = null;
    if (source === "standing") {
      // A child in exactly one group has an obvious home. A child in several
      // does not, and a child in none never did.
      const standing = (child.standingGroupIds ?? []).filter((id) =>
        groupIds.has(id),
      );
      groupId = standing.length === 1 ? standing[0] : null;
    } else if (source === "previous") {
      // A child who was not at the previous session — or whose group there has
      // since been deleted — has nothing to copy.
      groupId =
        child.previousGroupId && groupIds.has(child.previousGroupId)
          ? child.previousGroupId
          : null;
    } else {
      const key = gradeKeyOf(child.grade);
      groupId = key === null ? null : (byGrade.get(key) ?? null);
    }

    if (groupId) result.assignments.push({ participantId: child.participantId, groupId });
    else result.unmatched.push(child.participantId);
  }

  return result;
}

export type SplitChild = { groupId: string | null };

export type SplitSummary = {
  assigned: number;
  unassigned: number;
  /** Only the groups that actually hold someone today, in the given order. */
  perGroup: Array<{ groupId: string; name: string; count: number }>;
  /** Nobody has been placed yet: the day is "טרם חולק", not "as usual". */
  notSplit: boolean;
};

export function splitSummary(
  children: readonly SplitChild[],
  groups: readonly PrefillGroup[],
): SplitSummary {
  const counts = new Map<string, number>();
  let assigned = 0;
  for (const c of children) {
    if (!c.groupId) continue;
    assigned++;
    counts.set(c.groupId, (counts.get(c.groupId) ?? 0) + 1);
  }
  return {
    assigned,
    unassigned: children.length - assigned,
    perGroup: groups
      .filter((g) => counts.has(g.id))
      .map((g) => ({ groupId: g.id, name: g.name, count: counts.get(g.id)! })),
    notSplit: assigned === 0,
  };
}
