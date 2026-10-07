// The registration form (wave 3, item 8): one fixed form in code, given its
// parameters by the event — not a form builder.
//
// The fact that shapes this whole file: **the link is sent once, to the
// parents' WhatsApp group.** It identifies nobody. Anyone holding it can pick
// any child from the list and answer for them. So the rules here sort what a
// submission says into two piles:
//
//   - What it may change on its own: whether the child is coming, and with
//     food, on each day. The worst a stranger can do with that is move the
//     expected number, and the gate is what counts at the end.
//   - What waits for an adult: a child who is not on the roster yet, "goes
//     home alone", a new person to collect them, and a phone number that is
//     not the one on file. Those decide who takes a six-year-old home, or who
//     the staff ring in an emergency.
//
// Like src/lib/parents.ts, kept free of Prisma and NextAuth so the public page,
// the staff screens and the tests all read the same rules — the boundary of an
// unauthenticated write is only real if it is tested.

import { LOCAL_TIMEZONE } from "@/lib/attendance";
import { isDismissalMethod, isSameAuthorization, type DismissalMethod } from "@/lib/dismissal";
import { generateParentToken, isParentToken, createRateLimiter } from "@/lib/parents";
import { normalizeName, normalizePhone } from "@/lib/participants";

// ── The link ────────────────────────────────────────────────────────────────

// The same token as a parent's personal link (item 5): 256 bits, base64url.
// Reused rather than re-specified so the two open endpoints cannot drift into
// two different ideas of "long enough".
export const generateRegistrationToken = generateParentToken;
export const isRegistrationToken = isParentToken;

export function registrationPath(token: string): string {
  return `/r/${token}`;
}

export function registrationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${registrationPath(token)}`;
}

// Reading the form sends the list of children's names, so it is throttled like
// a write would be on most sites. A family opens it a few times; a scraper
// opens it hundreds. Writing is a handful per family per event.
export const REGISTRATION_READ_LIMIT = createRateLimiter(60, 10 * 60 * 1000);
export const REGISTRATION_WRITE_LIMIT = createRateLimiter(10, 10 * 60 * 1000);

// ── Open, closed ────────────────────────────────────────────────────────────

export type FormTimes = {
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
};

export type FormState =
  | "draft" // set up, link not sent yet
  | "open"
  | "closed"; // past the deadline, or closed by hand

/**
 * Whether the form takes submissions right now.
 *
 * Open from the moment the link is sent until whichever comes first: the
 * deadline the staff set, or the "close registration" button. A closed form
 * shows "registration closed" and nothing else — not the form, and above all
 * not the list of children.
 */
export function formState(form: FormTimes, now: Date = new Date()): FormState {
  if (!form.openedAt) return "draft";
  if (form.closedAt) return "closed";
  if (form.closesAt && now.getTime() >= form.closesAt.getTime()) return "closed";
  return "open";
}

// ── Israel wall-clock time ──────────────────────────────────────────────────
//
// The deadline is a moment ("Monday 20:00"), not a calendar day, so unlike the
// rest of the app it is a timestamp. It is typed and shown in Israel time, and
// stored as UTC. The conversion is done here by hand rather than by a library
// (no new npm dependency for one function) and is tested across both DST
// changes, because a deadline an hour off is a form that closes while a parent
// is filling it in.

function israelParts(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Minutes Israel is ahead of UTC at this instant (120 or 180). */
function israelOffsetMinutes(at: Date): number {
  const p = israelParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** "2026-10-12T20:00" in Israel → the instant. null when malformed. */
export function israelLocalToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Date.UTC rolls 31.02 over into March; refuse instead of storing another day.
  if (new Date(wall).toISOString().slice(0, 16) !== local) return null;

  // Two passes: the offset depends on the instant, and the first guess may sit
  // on the other side of a DST change.
  let guess = wall - israelOffsetMinutes(new Date(wall)) * 60000;
  guess = wall - israelOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

/** The instant as Israel wall-clock "YYYY-MM-DDTHH:mm" — the value a datetime-local input takes. */
export function dateToIsraelLocal(at: Date): string {
  const p = israelParts(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// ── Which days the form asks about ──────────────────────────────────────────

export type FormDayInput = { id: string; date: string };

// A camp asks about every remaining day of the camp. A recurring event — a
// school year of Tuesdays and Fridays — asks about the coming week only:
// registration here happens the evening before, and a form that lists the
// next forty sessions is a form nobody scrolls to the end of.
export const RECURRING_WINDOW_DAYS = 7;
export const MAX_FORM_DAYS = 31;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The days a submission answers for, from today onwards.
 *
 * Today is included: a form still open on the morning of the session is a
 * form a parent can use to say "not today".
 */
export function formDays<T extends FormDayInput>(
  days: readonly T[],
  kind: "camp" | "recurring",
  today: string,
): T[] {
  const upcoming = [...days]
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const windowed =
    kind === "recurring"
      ? upcoming.filter((d) => d.date < addDays(today, RECURRING_WINDOW_DAYS))
      : upcoming;
  return windowed.slice(0, MAX_FORM_DAYS);
}

// ── Equipment ───────────────────────────────────────────────────────────────

// Suggestions only, not a default: every event starts with an empty list and
// the staff decide what goes on it before the link is sent.
export const EQUIPMENT_SUGGESTIONS = [
  "מים",
  "כובע",
  "נעליים סגורות",
  "קרם הגנה",
  "בגד ים",
  "מגבת",
] as const;

export const EQUIPMENT_ITEM_MAX = 60;
export const EQUIPMENT_LIST_MAX = 30;

/** Trims, drops empties and repeats, caps the length. null when the input is not a list of strings. */
export function normalizeEquipment(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const item = raw.replace(/\s+/g, " ").trim();
    if (!item) continue;
    if (item.length > EQUIPMENT_ITEM_MAX) return null;
    const key = normalizeName(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.length > EQUIPMENT_LIST_MAX ? null : out;
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// ── The staff's settings ────────────────────────────────────────────────────

export const INTRO_MAX = 1000;
export const PRICE_MAX = 80;
export const CAPACITY_MAX = 500;

export type FormSettings = {
  intro: string | null;
  price: string | null;
  capacity: number | null;
  autoApprove: boolean;
  closesAt: Date | null;
  equipment: string[];
  /** Per-day additions, keyed by EventDay id. Only days present are touched. */
  dayEquipment: Record<string, string[]>;
};

export type SettingsResult =
  | { ok: true; value: FormSettings }
  | { ok: false; error: string };

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (t.length > max) return undefined;
  return t || null;
}

export function parseFormSettings(body: Record<string, unknown> | null): SettingsResult {
  const intro = optionalText(body?.intro, INTRO_MAX);
  if (intro === undefined) return { ok: false, error: `טקסט הפתיחה ארוך מדי (עד ${INTRO_MAX} תווים)` };
  const price = optionalText(body?.price, PRICE_MAX);
  if (price === undefined) return { ok: false, error: "מחיר לא תקין" };

  let capacity: number | null = null;
  const rawCap = body?.capacity;
  if (rawCap !== undefined && rawCap !== null && rawCap !== "") {
    const n = typeof rawCap === "number" ? rawCap : Number(rawCap);
    if (!Number.isInteger(n) || n < 1 || n > CAPACITY_MAX) {
      return { ok: false, error: "מכסה צריכה להיות מספר שלם חיובי" };
    }
    capacity = n;
  }

  const autoApprove = body?.autoApprove;
  if (typeof autoApprove !== "boolean") return { ok: false, error: "חסרה בחירת אופן האישור" };

  let closesAt: Date | null = null;
  const rawCloses = body?.closesAt;
  if (rawCloses !== undefined && rawCloses !== null && rawCloses !== "") {
    closesAt = typeof rawCloses === "string" ? israelLocalToDate(rawCloses) : null;
    if (!closesAt) return { ok: false, error: "מועד הסגירה לא תקין" };
  }

  const equipment = normalizeEquipment(body?.equipment ?? []);
  if (!equipment) return { ok: false, error: "רשימת הציוד לא תקינה" };

  const dayEquipment: Record<string, string[]> = {};
  const rawDays = body?.dayEquipment ?? {};
  if (typeof rawDays !== "object" || rawDays === null || Array.isArray(rawDays)) {
    return { ok: false, error: "רשימת הציוד ליום לא תקינה" };
  }
  for (const [dayId, list] of Object.entries(rawDays)) {
    const items = normalizeEquipment(list);
    if (!items || !isRecordId(dayId)) return { ok: false, error: "רשימת הציוד ליום לא תקינה" };
    dayEquipment[dayId] = items;
  }

  return {
    ok: true,
    value: { intro, price, capacity, autoApprove, closesAt, equipment, dayEquipment },
  };
}

// ── A submission ────────────────────────────────────────────────────────────

// Prisma's cuid(). Checked before the id reaches a query, like the token: the
// body comes from an open endpoint.
const RECORD_ID_RE = /^[a-z0-9]{20,40}$/;
export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID_RE.test(value);
}

export const MAX_CHILDREN_PER_SUBMISSION = 6;
export const NAME_MAX = 60;
export const GRADE_MAX = 12;
export const NOTE_MAX = 300;

export type DayAnswer = { coming: boolean; bringsFood: boolean | null };

export type PickupRequest = {
  name: string;
  relation: string | null;
  phone: string;
};

export type ChildSubmission = {
  child:
    | { kind: "existing"; participantId: string }
    | { kind: "new"; name: string; grade: string | null };
  parentName: string;
  parentPhone: string; // normalized
  dismissal: DismissalMethod;
  /** Only when someone comes to collect them. */
  pickup: PickupRequest | null;
  days: Record<string, DayAnswer>; // by EventDay id — every offered day, exactly
  note: string | null;
  equipmentAck: boolean;
};

export type SubmissionResult =
  | { ok: true; children: ChildSubmission[] }
  | { ok: false; error: string };

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t && t.length <= max ? t : null;
}

/** A phone a gate can dial: 9–15 digits once the dashes are gone. */
export function parsePhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 30) return null;
  const n = normalizePhone(value);
  if (!n) return null;
  const digits = n.replace(/\D/g, "").length;
  return digits >= 9 && digits <= 15 ? n : null;
}

/**
 * Reads the whole submission, or refuses it whole.
 *
 * All or nothing on purpose: a family sending two children and getting one
 * saved and an error about the other is a family that sends both again and
 * now has a duplicate, or does not and has a missing child.
 *
 * Every offered day must be answered, and only offered days: a missing answer
 * would be invented as "not coming" by somebody, and a day id the form did not
 * offer is either a stale page or someone poking at the endpoint.
 */
export function parseSubmission(
  body: Record<string, unknown> | null,
  offeredDayIds: readonly string[],
  { equipmentRequired }: { equipmentRequired: boolean },
): SubmissionResult {
  const list = body?.children;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, error: "לא נבחר אף ילד/ה" };
  }
  if (list.length > MAX_CHILDREN_PER_SUBMISSION) {
    return { ok: false, error: `אפשר לרשום עד ${MAX_CHILDREN_PER_SUBMISSION} ילדים בשליחה אחת` };
  }

  const offered = new Set(offeredDayIds);
  const seenExisting = new Set<string>();
  const seenNew = new Set<string>();
  const out: ChildSubmission[] = [];

  for (let i = 0; i < list.length; i++) {
    const raw = list[i] as Record<string, unknown> | null;
    const who = list.length > 1 ? `ילד/ה ${i + 1}: ` : "";
    const fail = (error: string): SubmissionResult => ({ ok: false, error: who + error });
    if (!raw || typeof raw !== "object") return fail("פרטים חסרים");

    let child: ChildSubmission["child"];
    if (raw.participantId !== undefined && raw.participantId !== null && raw.participantId !== "") {
      if (!isRecordId(raw.participantId)) return fail("הילד/ה שנבחר/ה לא נמצא/ה ברשימה");
      if (seenExisting.has(raw.participantId)) return fail("אותו ילד/ה נבחר/ה פעמיים");
      seenExisting.add(raw.participantId);
      child = { kind: "existing", participantId: raw.participantId };
    } else {
      const nc = raw.newChild as Record<string, unknown> | null | undefined;
      const name = requiredText(nc?.name, NAME_MAX);
      if (!name) return fail("צריך לבחור ילד/ה מהרשימה או לכתוב שם");
      const grade = optionalText(nc?.grade, GRADE_MAX);
      if (grade === undefined) return fail("כיתה לא תקינה");
      if (!grade) return fail("צריך לכתוב כיתה");
      const key = normalizeName(name);
      if (seenNew.has(key)) return fail("אותו שם הופיע פעמיים");
      seenNew.add(key);
      child = { kind: "new", name, grade };
    }

    const parentName = requiredText(raw.parentName, NAME_MAX);
    if (!parentName) return fail("צריך לכתוב את שם ההורה שממלא/ת");
    const parentPhone = parsePhone(raw.parentPhone);
    if (!parentPhone) return fail("צריך טלפון תקין של ההורה");

    const dismissal = raw.dismissal;
    if (!isDismissalMethod(dismissal)) {
      return fail("צריך לבחור איך הילד/ה חוזר/ת הביתה");
    }

    let pickup: PickupRequest | null = null;
    if (dismissal === "escort") {
      const p = raw.pickup as Record<string, unknown> | null | undefined;
      const name = requiredText(p?.name, NAME_MAX);
      if (!name) return fail("צריך לכתוב מי בא/ה לאסוף");
      const relation = optionalText(p?.relation, 30);
      if (relation === undefined) return fail("קרבה לא תקינה");
      const phone = parsePhone(p?.phone);
      if (!phone) return fail("צריך טלפון תקין של מי שאוסף/ת");
      pickup = { name, relation, phone };
    }

    const rawDays = raw.days;
    if (!Array.isArray(rawDays)) return fail("חסרות תשובות לימים");
    const days: Record<string, DayAnswer> = {};
    for (const d of rawDays as Record<string, unknown>[]) {
      const id = d?.eventDayId;
      if (typeof id !== "string" || !offered.has(id) || days[id]) {
        return fail("יום לא תקין — כדאי לרענן את הדף");
      }
      if (typeof d.coming !== "boolean") return fail("צריך לסמן מגיע/ה או לא לכל יום");
      let bringsFood: boolean | null = null;
      if (d.coming) {
        if (typeof d.bringsFood !== "boolean") return fail("צריך לסמן אם מגיע/ה עם אוכל");
        bringsFood = d.bringsFood;
      }
      days[id] = { coming: d.coming, bringsFood };
    }
    if (Object.keys(days).length !== offered.size) {
      return fail("צריך לסמן מגיע/ה או לא לכל יום");
    }

    const note = optionalText(raw.note, NOTE_MAX);
    if (note === undefined) return fail(`ההערה ארוכה מדי (עד ${NOTE_MAX} תווים)`);

    const equipmentAck = raw.equipmentAck === true;
    if (equipmentRequired && !equipmentAck) return fail("צריך לאשר שקראת את רשימת הציוד");

    out.push({
      child,
      parentName,
      parentPhone,
      dismissal,
      pickup,
      days,
      note,
      equipmentAck,
    });
  }
  return { ok: true, children: out };
}

export function comingAnyDay(days: Record<string, DayAnswer> | readonly DayAnswer[]): boolean {
  return Object.values(days).some((d) => d.coming);
}

// ── What waits for an adult ─────────────────────────────────────────────────

export const REVIEW_REASONS = [
  "new_child",
  "dismissal_alone",
  "new_pickup",
  "contact_differs",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  new_child: "ילד/ה חדש/ה — לא ברשימה",
  dismissal_alone: "ביקשו: הולך/ת הביתה לבד",
  new_pickup: "מורשה איסוף חדש/ה",
  contact_differs: "הטלפון בהגשה שונה מהשמור",
};

export type StoredChild = {
  defaultDismissal: string;
  parentPhone: string | null;
  authorizations: readonly { name: string; phone: string | null }[];
};

/**
 * What in this submission differs from what is on file, and so has to wait
 * for an adult.
 *
 * **Only a difference waits.** Most parents will tick exactly what was already
 * true, and forty identical approvals are a queue nobody works through. The
 * answer the parent sees is the same either way (see the route), so the form
 * cannot be used to find out what is on file.
 *
 * `tightenToEscort` is the one change applied without waiting: a child on
 * "may go home alone" whose parent now says somebody is coming. That is the
 * safe direction — the child waits at the gate for an adult — and holding it
 * for approval would leave the unsafe instruction in force in the meantime,
 * with the parent believing they had changed it.
 */
export function reviewFor(
  entry: Pick<ChildSubmission, "child" | "dismissal" | "pickup" | "parentPhone">,
  stored: StoredChild | null,
): { reasons: ReviewReason[]; tightenToEscort: boolean } {
  if (entry.child.kind === "new" || !stored) {
    const reasons: ReviewReason[] = ["new_child"];
    if (entry.dismissal === "alone") reasons.push("dismissal_alone");
    if (entry.pickup) reasons.push("new_pickup");
    return { reasons, tightenToEscort: false };
  }

  const reasons: ReviewReason[] = [];
  const storedAlone = stored.defaultDismissal === "alone";
  if (entry.dismissal === "alone" && !storedAlone) reasons.push("dismissal_alone");
  if (
    entry.pickup &&
    !stored.authorizations.some((a) => isSameAuthorization(a, entry.pickup!))
  ) {
    reasons.push("new_pickup");
  }
  const storedPhone = stored.parentPhone ? normalizePhone(stored.parentPhone) : null;
  if (storedPhone !== entry.parentPhone) reasons.push("contact_differs");

  return { reasons, tightenToEscort: entry.dismissal === "escort" && storedAlone };
}

// ── Status, the cap and the waiting list ────────────────────────────────────

export const REGISTRATION_STATUSES = ["approved", "pending", "waitlist", "rejected"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  approved: "רשום/ה",
  pending: "ממתין/ה לאישור",
  waitlist: "ברשימת המתנה",
  rejected: "נדחה",
};

/** Holds a place against the cap: approved, and actually coming on some day. */
export function holdsPlace(status: string, coming: boolean): boolean {
  return status === "approved" && coming;
}

/**
 * The status a submission lands in.
 *
 * - A **new child always waits** for an adult, even when the event approves
 *   automatically — otherwise anyone holding the link can fill the roster with
 *   invented children.
 * - **A full event is a waiting list, not a refusal**, in order of first
 *   submission. "Full" also means "someone is already waiting ahead of you":
 *   a place freed by a cancellation goes to the head of the list, through an
 *   adult, not to whoever happens to submit next.
 * - A registration that **already holds a place keeps it** when the family
 *   changes their answers — a child who was sick on Tuesday morning must not
 *   lose Wednesday to the person who submitted at 06:59.
 * - A child **not coming on any day** needs no place, so a cap never puts
 *   "not coming" on a waiting list.
 * - Otherwise: approved straight away, or pending when the event wants manual
 *   approval (a camp with a fee — an unpaid registration must not hold a
 *   place).
 */
export function decideStatus({
  isNew,
  autoApprove,
  capacity,
  placesTaken,
  waitlistAhead,
  coming,
  alreadyHoldsPlace,
}: {
  isNew: boolean;
  autoApprove: boolean;
  capacity: number | null;
  /** Places held by other registrations on this form. */
  placesTaken: number;
  /** Waiting-list registrations on this form submitted before this one. */
  waitlistAhead: number;
  coming: boolean;
  alreadyHoldsPlace: boolean;
}): RegistrationStatus {
  if (alreadyHoldsPlace) return "approved";
  const full =
    coming && capacity !== null && (placesTaken >= capacity || waitlistAhead > 0);
  if (full) return "waitlist";
  if (isNew) return "pending";
  if (!coming) return "approved";
  return autoApprove ? "approved" : "pending";
}

/** What the parent is told. Pending and approved read the same: the form does not reveal what is queued. */
export function parentOutcome(status: RegistrationStatus): "received" | "waitlist" {
  return status === "waitlist" ? "waitlist" : "received";
}
