import { describe, expect, it } from "vitest";
import {
  PARENT_NOTE_MAX,
  PARENT_TOKEN_MIN_LENGTH,
  createRateLimiter,
  expectedCount,
  generateParentToken,
  isParentToken,
  parentLinkPath,
  parentLinkUrl,
  parentReplyState,
  parseParentAnswer,
} from "../parents";

describe("the parent token", () => {
  it("is long, URL-safe and different every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const token = generateParentToken();
      expect(token.length).toBeGreaterThanOrEqual(PARENT_TOKEN_MIN_LENGTH);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      seen.add(token);
    }
    // The link is the only proof of identity there is. A generator that
    // repeats itself hands one family another family's child.
    expect(seen.size).toBe(200);
  });

  it("accepts what it generates", () => {
    for (let i = 0; i < 50; i++) {
      expect(isParentToken(generateParentToken())).toBe(true);
    }
  });

  it("rejects anything that is not a token before it reaches the database", () => {
    for (const bad of [
      "",
      "short",
      "a".repeat(31),
      "a".repeat(129),
      // The characters that would make a token worth passing to a query in the
      // first place: padding, slashes, wildcards, whitespace.
      `${"a".repeat(40)}/../../etc`,
      `${"a".repeat(40)}%`,
      `${"a".repeat(40)} `,
      `${"a".repeat(40)}=`,
      null,
      undefined,
      12345,
      {},
      ["a".repeat(40)],
    ]) {
      expect(isParentToken(bad)).toBe(false);
    }
  });

  it("builds the link the same way everywhere", () => {
    const token = generateParentToken();
    expect(parentLinkPath(token)).toBe(`/p/${token}`);
    expect(parentLinkUrl("https://example.com", token)).toBe(
      `https://example.com/p/${token}`,
    );
    // A trailing slash on the configured origin is the ordinary copy-paste
    // mistake, and "https://example.com//p/…" is a link that 404s.
    expect(parentLinkUrl("https://example.com/", token)).toBe(
      `https://example.com/p/${token}`,
    );
  });
});

describe("parsing what a parent sent", () => {
  it("takes a yes or a no with an optional note", () => {
    expect(parseParentAnswer({ coming: true })).toEqual({
      ok: true,
      value: { coming: true, note: null },
    });
    expect(parseParentAnswer({ coming: false, note: "  חולה  " })).toEqual({
      ok: true,
      value: { coming: false, note: "חולה" },
    });
  });

  it("refuses a missing answer rather than guessing one", () => {
    // This is the number the kitchen and the staffing alert read. Defaulting
    // it invents an answer on behalf of a six-year-old's parent.
    for (const body of [null, {}, { coming: "yes" }, { coming: 1 }, { coming: null }]) {
      expect(parseParentAnswer(body as Record<string, unknown>).ok).toBe(false);
    }
  });

  it("caps the note instead of storing a paragraph", () => {
    const long = { coming: true, note: "א".repeat(PARENT_NOTE_MAX + 1) };
    expect(parseParentAnswer(long).ok).toBe(false);

    const atLimit = { coming: true, note: "א".repeat(PARENT_NOTE_MAX) };
    expect(parseParentAnswer(atLimit).ok).toBe(true);
  });

  it("treats an empty note as no note", () => {
    const result = parseParentAnswer({ coming: true, note: "   " });
    expect(result).toEqual({ ok: true, value: { coming: true, note: null } });
  });

  it("refuses a note that is not text", () => {
    expect(parseParentAnswer({ coming: true, note: { a: 1 } }).ok).toBe(false);
  });
});

describe("the expected head count", () => {
  const roster = ["a", "b", "c", "d", "e"];

  it("counts a child nobody answered for as coming", () => {
    // The asymmetry is the whole rule: cooking for four too many is leftovers,
    // counting four out who then arrive is a counselor short.
    const count = expectedCount(roster, []);
    expect(count.expected).toBe(5);
    expect(count.noAnswer).toBe(5);
    expect(count.coming).toBe(0);
    expect(count.notComing).toBe(0);
  });

  it("removes only the children a parent actively said no for", () => {
    const count = expectedCount(roster, [
      { participantId: "a", coming: true },
      { participantId: "b", coming: false },
      { participantId: "c", coming: false },
    ]);
    expect(count).toEqual({
      rostered: 5,
      coming: 1,
      notComing: 2,
      noAnswer: 2,
      expected: 3,
    });
  });

  it("ignores an answer for a child who is no longer on the event", () => {
    // The row outlives the membership: a child taken off the event, or soft
    // deleted, must not keep moving the number the kitchen cooks to.
    const count = expectedCount(roster, [
      { participantId: "gone", coming: false },
      { participantId: "a", coming: false },
    ]);
    expect(count.expected).toBe(4);
    expect(count.notComing).toBe(1);
    expect(count.noAnswer).toBe(4);
  });

  it("lets the last answer for a child win rather than counting them twice", () => {
    const count = expectedCount(roster, [
      { participantId: "a", coming: false },
      { participantId: "a", coming: true },
    ]);
    expect(count.coming).toBe(1);
    expect(count.notComing).toBe(0);
    expect(count.expected).toBe(5);
  });

  it("handles an event with nobody on it", () => {
    expect(expectedCount([], [{ participantId: "a", coming: true }])).toEqual({
      rostered: 0,
      coming: 0,
      notComing: 0,
      noAnswer: 0,
      expected: 0,
    });
  });
});

describe("how a reply reads on the staff screen", () => {
  it("tells silence apart from a no", () => {
    expect(parentReplyState(true)).toBe("coming");
    expect(parentReplyState(false)).toBe("not-coming");
    expect(parentReplyState(null)).toBe("no-answer");
    expect(parentReplyState(undefined)).toBe("no-answer");
  });
});

describe("the throttle on an open endpoint", () => {
  it("allows the allowance and refuses the next one", () => {
    const limiter = createRateLimiter(3, 1000);
    const now = 1_000_000;
    expect(limiter.check("ip", now)).toBe(false);
    expect(limiter.check("ip", now)).toBe(false);
    expect(limiter.check("ip", now)).toBe(false);
    expect(limiter.check("ip", now)).toBe(true);
  });

  it("counts each caller separately", () => {
    const limiter = createRateLimiter(1, 1000);
    const now = 1_000_000;
    expect(limiter.check("a", now)).toBe(false);
    expect(limiter.check("b", now)).toBe(false);
    expect(limiter.check("a", now)).toBe(true);
    expect(limiter.check("b", now)).toBe(true);
  });

  it("forgives once the window has passed", () => {
    const limiter = createRateLimiter(1, 1000);
    const now = 1_000_000;
    expect(limiter.check("ip", now)).toBe(false);
    expect(limiter.check("ip", now)).toBe(true);
    expect(limiter.check("ip", now + 1001)).toBe(false);
  });
});
