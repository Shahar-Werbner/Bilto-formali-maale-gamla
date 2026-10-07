// The staff's view of an event's registrations, and what reaches the day
// screen from them (item 8b). Pure rules only — the queries are in
// registration-overview-server.ts — so the counts the kitchen cooks to and the
// list the staff send a reminder to can be tested without a database.

import { sortByGrade } from "@/lib/attendance";
import { normalizeName } from "@/lib/participants";

// ── Food per day ────────────────────────────────────────────────────────────

export type FoodAnswer = { coming: boolean; bringsFood: boolean | null };

export type FoodCount = {
  /** Expected on the day. */
  coming: number;
  /** Coming and bringing their own food. */
  withFood: number;
  /** Coming without food — the ones the kitchen cooks for. */
  withoutFood: number;
  /** Coming, and nobody said either way (a link answer, or an older row). */
  unknown: number;
};

/**
 * The kitchen's numbers for one day.
 *
 * "Unknown" is kept apart rather than folded into either side: the safe
 * reading for the kitchen is to cook for it, but that is the reader's call,
 * and a number that silently includes guesses is one nobody can check.
 */
export function foodCount(answers: readonly FoodAnswer[]): FoodCount {
  const out: FoodCount = { coming: 0, withFood: 0, withoutFood: 0, unknown: 0 };
  for (const a of answers) {
    if (!a.coming) continue;
    out.coming++;
    if (a.bringsFood === true) out.withFood++;
    else if (a.bringsFood === false) out.withoutFood++;
    else out.unknown++;
  }
  return out;
}

/** The same numbers from a `groupBy(["coming", "bringsFood"])` in the database. */
export function foodCountFromGroups(
  groups: readonly (FoodAnswer & { count: number })[],
): FoodCount {
  const out: FoodCount = { coming: 0, withFood: 0, withoutFood: 0, unknown: 0 };
  for (const g of groups) {
    if (!g.coming) continue;
    out.coming += g.count;
    if (g.bringsFood === true) out.withFood += g.count;
    else if (g.bringsFood === false) out.withoutFood += g.count;
    else out.unknown += g.count;
  }
  return out;
}

// ── Equipment at the gate ───────────────────────────────────────────────────

/**
 * "היום צריך: …" — the whole event's list, then the day's own additions,
 * without repeating an item that is on both. Same normalisation the settings
 * use, so "כובע" and "כובע " are one item.
 */
export function dayEquipment(
  eventEquipment: readonly string[],
  dayEquipmentList: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...eventEquipment, ...dayEquipmentList]) {
    const key = normalizeName(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

// ── Who has not registered yet ──────────────────────────────────────────────

export type EventRef = { id: string; startDate: string; endDate: string };

/**
 * "The previous event": the latest live event that started before this one.
 *
 * By start date, not by creation date: camps are often set up weeks ahead in
 * a batch, and the one created last is not the one the children were at last.
 */
export function previousEvent<T extends EventRef>(
  events: readonly T[],
  current: EventRef,
): T | null {
  let best: T | null = null;
  for (const e of events) {
    if (e.id === current.id || e.startDate >= current.startDate) continue;
    if (
      !best ||
      e.startDate > best.startDate ||
      (e.startDate === best.startDate && e.endDate > best.endDate)
    ) {
      best = e;
    }
  }
  return best;
}

/**
 * Who "took part" in the previous event: the children marked present or late
 * on some day of it. When nobody was ever marked there — attendance was not
 * kept, which is the case for the first events in this system — the
 * children who were on it stand in, because an empty reminder list reads as
 * "everyone already registered".
 */
export function previousParticipants(
  attendedIds: readonly string[],
  rosteredIds: readonly string[],
): { ids: string[]; basis: "attended" | "rostered" } {
  return attendedIds.length > 0
    ? { ids: [...new Set(attendedIds)], basis: "attended" }
    : { ids: [...new Set(rosteredIds)], basis: "rostered" };
}

/**
 * The reminder list: children from the previous event that this form has not
 * heard about at all.
 *
 * Any submission takes a child off it — a waiting-list place, a pending one,
 * even "not coming" or a rejection: the family has answered, and the list is
 * for nudging the families who have not. `candidates` must already be live
 * children only (invariant 1).
 */
export function notYetRegistered<T extends { id: string; name: string; grade?: string | null }>(
  candidates: readonly T[],
  answeredIds: ReadonlySet<string>,
): T[] {
  return sortByGrade(candidates.filter((c) => !answeredIds.has(c.id)));
}

/**
 * The text that goes into the WhatsApp group: a title and one name per line.
 * Names only — this is pasted into a group of every family, so no grade, no
 * phone, nothing that is not already how the children greet each other.
 */
export function whatsappNameList(title: string, names: readonly string[]): string {
  return [title, ...names.map((n) => `• ${n}`)].join("\n");
}

// ── The parent's free note ──────────────────────────────────────────────────

// Israeli phone numbers as people type them: 050-1234567, 0501234567,
// +972 50 123 4567, 02-6123456.
const PHONE_PATTERN = /(?:\+?972[\s-]?|0)\d(?:[\s-]?\d){6,8}/g;

/**
 * A parent's free note, for a reader without `roster:contacts`.
 *
 * The note is the one field a parent can put anything in, and "אם יש בעיה
 * תתקשרו לסבתא 052-…" is a natural thing to write. A youth counselor needs the
 * sentence — the child leaves early, is afraid of dogs — but not the number,
 * which is exactly the contact detail the role is kept away from.
 */
export function hidePhones(text: string): string {
  return text.replace(PHONE_PATTERN, "[טלפון מוסתר]");
}
