// Parents telling us whether their child is coming, and asking for a one-off
// change to who collects them (wave 3, item 5).
//
// The decision that shapes this whole file: **there are no parent accounts.**
// A parent gets a personal link carrying a long random token, the way a
// calendar subscription link works. Fifty families will not create fifty
// passwords for a Tuesday afternoon, and a login they use twice a year is a
// login they have lost by November.
//
// The price of that decision is that every write arriving here is
// **unauthenticated** — the token is the whole proof. That is why this file
// exists separately from the routes: the rules about what a link may do, how
// long a token is, and how often it may be tried are the security boundary,
// and a boundary that cannot be unit-tested is a boundary nobody checks.
//
// Kept free of Prisma, NextAuth and node-only imports so it can be read by the
// parent's own page, by the staff screens, and by the tests alike.

// ── The token ───────────────────────────────────────────────────────────────

// 32 bytes = 256 bits of randomness, base64url-encoded to 43 characters. The
// link is sent over WhatsApp and lives in a phone's message history forever,
// so it has to survive being copied, forwarded and typed badly — but it is the
// only thing standing between a stranger and a six-year-old's record, so it is
// not short. Guessing one is not a thing that happens; losing one to a
// forwarded message is, which is what revocation below is for.
export const PARENT_TOKEN_BYTES = 32;

// base64url: the URL-safe alphabet, so the token survives being pasted into a
// message, a browser bar, or a QR code without escaping.
const TOKEN_ALPHABET_RE = /^[A-Za-z0-9_-]+$/;

// Length is checked as a range rather than an exact number on purpose: a token
// issued by an older version with a different size must keep working, and a
// link that stops working is a parent who goes back to WhatsApping the staff.
export const PARENT_TOKEN_MIN_LENGTH = 32;
export const PARENT_TOKEN_MAX_LENGTH = 128;

/** Is this the shape of a parent token at all? Cheap rejection before any query. */
export function isParentToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= PARENT_TOKEN_MIN_LENGTH &&
    value.length <= PARENT_TOKEN_MAX_LENGTH &&
    TOKEN_ALPHABET_RE.test(value)
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A fresh token.
 *
 * Web Crypto rather than `node:crypto` so this module stays importable from
 * anywhere — including a client component — without the bundler pulling a
 * Node built-in into the browser. `getRandomValues` is a CSPRNG in Node 18+,
 * in the Edge runtime and in every browser this runs on; `Math.random` is not,
 * and this is exactly the place where that difference is the whole thing.
 */
export function generateParentToken(): string {
  const bytes = new Uint8Array(PARENT_TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** The path a parent opens. One place, so the link in a message and the route agree. */
export function parentLinkPath(token: string): string {
  return `/p/${token}`;
}

/** The full link to send, given wherever the app is deployed. */
export function parentLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${parentLinkPath(token)}`;
}

// ── What a parent may say ───────────────────────────────────────────────────

// A parent answers one question — is your child coming — and may add a short
// free-text note. The note is capped because it is unauthenticated free text
// that a counselor reads on a phone at the gate: a paragraph there is a
// paragraph nobody reads, and an unbounded column is a way to fill a database.
export const PARENT_NOTE_MAX = 200;

export type ParentAnswer = {
  /** Is the child coming to this session? */
  coming: boolean;
  /** A one-off message from the parent, usually about who is collecting. */
  note: string | null;
};

export type ParentAnswerResult =
  | { ok: true; value: ParentAnswer }
  | { ok: false; error: string };

/**
 * Parses what the parent's form sent.
 *
 * `coming` is required and must be a real boolean: this is the number the
 * kitchen and the staffing alert are derived from, and a missing answer has to
 * stay "we do not know" rather than becoming a silent "no". Defaulting it
 * either way would invent an answer for a six-year-old's parent.
 */
export function parseParentAnswer(
  body: Record<string, unknown> | null,
): ParentAnswerResult {
  const coming = body?.coming;
  if (typeof coming !== "boolean") {
    return { ok: false, error: "צריך לבחור אם הילד/ה מגיע/ה" };
  }

  const rawNote = body?.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") {
    return { ok: false, error: "הערה לא תקינה" };
  }
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length > PARENT_NOTE_MAX) {
    return {
      ok: false,
      error: `ההערה ארוכה מדי (עד ${PARENT_NOTE_MAX} תווים)`,
    };
  }

  return { ok: true, value: { coming, note: note || null } };
}

// ── The expected head count ─────────────────────────────────────────────────

export type ExpectedAnswer = {
  participantId: string;
  coming: boolean;
};

export type ExpectedCount = {
  /** Children on the event — the most who can turn up. */
  rostered: number;
  /** Parents who said yes. */
  coming: number;
  /** Parents who said no. */
  notComing: number;
  /** Nobody answered for these, and they are counted as coming. */
  noAnswer: number;
  /**
   * What to cook for and staff for: everyone except the children whose parents
   * actively said no.
   */
  expected: number;
};

/**
 * The number this whole item exists to produce.
 *
 * The rule is one line and it is the important line: **silence means coming.**
 * A child whose parent never opened the link is counted in, because the
 * failure modes are not symmetrical — cooking for four too many is lunch left
 * over, and counting four children out who then walk through the door is a
 * counselor short and not enough food. Only an explicit "no" removes anyone.
 */
export function expectedCount(
  rosteredIds: readonly string[],
  answers: readonly ExpectedAnswer[],
): ExpectedCount {
  const onEvent = new Set(rosteredIds);
  // An answer for a child who has since been taken off the event, or soft
  // deleted, must not move the count — the row outlives the membership.
  const relevant = new Map<string, boolean>();
  for (const a of answers) {
    if (onEvent.has(a.participantId)) relevant.set(a.participantId, a.coming);
  }

  let coming = 0;
  let notComing = 0;
  for (const isComing of relevant.values()) {
    if (isComing) coming++;
    else notComing++;
  }

  const rostered = onEvent.size;
  return {
    rostered,
    coming,
    notComing,
    noAnswer: rostered - relevant.size,
    expected: rostered - notComing,
  };
}

// ── Labels ──────────────────────────────────────────────────────────────────

export type ParentReplyState = "coming" | "not-coming" | "no-answer";

export function parentReplyState(coming: boolean | null | undefined): ParentReplyState {
  if (coming === true) return "coming";
  if (coming === false) return "not-coming";
  return "no-answer";
}

export const PARENT_REPLY_LABEL: Record<ParentReplyState, string> = {
  coming: "מגיע/ה",
  "not-coming": "לא מגיע/ה",
  "no-answer": "אין תשובה",
};

// ── Rate limiting ───────────────────────────────────────────────────────────
//
// An open endpoint that takes a token from the URL is a guessing target, and
// unlike the staff sign-in there is no account to lock. A 256-bit token is not
// realistically guessable, but the throttle is what makes that true rather than
// merely likely — and it also caps what a leaked link can do in a minute.
//
// In-memory and per serverless instance, like the one on /api/register: enough
// to make scripted guessing pointless, not a security boundary on its own.
// `now` is injected so the behaviour is testable without waiting ten minutes.

export type RateLimiter = {
  /** true when this key has spent its allowance for the window. */
  check(key: string, now?: number): boolean;
  reset(): void;
};

export function createRateLimiter(max: number, windowMs: number): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string, now: number = Date.now()): boolean {
      const entry = hits.get(key);
      if (!entry || now > entry.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      entry.count++;
      return entry.count > max;
    },
    reset() {
      hits.clear();
    },
  };
}

// Reading a link is cheap and a parent may refresh; writing is once or twice a
// session. Both are generous for a real family and useless for a script.
export const PARENT_READ_LIMIT = createRateLimiter(60, 10 * 60 * 1000);
export const PARENT_WRITE_LIMIT = createRateLimiter(20, 10 * 60 * 1000);
