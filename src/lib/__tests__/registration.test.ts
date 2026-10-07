import { describe, expect, it } from "vitest";
import {
  MAX_CHILDREN_PER_SUBMISSION,
  REGISTRATION_STATUSES,
  dateToIsraelLocal,
  decideStatus,
  formDays,
  formState,
  generateRegistrationToken,
  isRecordId,
  isRegistrationToken,
  israelLocalToDate,
  normalizeEquipment,
  parentOutcome,
  parseFormSettings,
  parseSubmission,
  registrationUrl,
  reviewFor,
  type ChildSubmission,
} from "../registration";
import { expectedCount, expectedHeadcount } from "../parents";

const ID = "ckxyz0000000000000000001";
const ID2 = "ckxyz0000000000000000002";

describe("the link", () => {
  it("is a long random token, and junk is refused before any query", () => {
    const t = generateRegistrationToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(isRegistrationToken(t)).toBe(true);
    for (const bad of ["", "short", "../../etc", "a".repeat(200), "x y".repeat(20), null, 42]) {
      expect(isRegistrationToken(bad)).toBe(false);
    }
  });

  it("is a different token every time — reissuing has to kill the old one", () => {
    const seen = new Set(Array.from({ length: 100 }, generateRegistrationToken));
    expect(seen.size).toBe(100);
  });

  it("builds the /r/ link", () => {
    expect(registrationUrl("https://x.app/", "abc")).toBe("https://x.app/r/abc");
  });
});

describe("open and closed", () => {
  const now = new Date("2026-10-12T15:00:00Z");
  const opened = new Date("2026-10-11T10:00:00Z");

  it("is a draft until the link is sent", () => {
    expect(formState({ openedAt: null, closesAt: null, closedAt: null }, now)).toBe("draft");
  });

  it("is open after sending, with no deadline", () => {
    expect(formState({ openedAt: opened, closesAt: null, closedAt: null }, now)).toBe("open");
  });

  it("closes at the deadline, to the minute", () => {
    const closesAt = new Date("2026-10-12T15:00:00Z");
    expect(formState({ openedAt: opened, closesAt, closedAt: null }, new Date(closesAt.getTime() - 1))).toBe("open");
    expect(formState({ openedAt: opened, closesAt, closedAt: null }, closesAt)).toBe("closed");
  });

  it("closes by hand, whatever the deadline says", () => {
    const closesAt = new Date("2026-10-20T00:00:00Z");
    expect(formState({ openedAt: opened, closesAt, closedAt: now }, now)).toBe("closed");
  });
});

describe("Israel time for the deadline", () => {
  it("reads Monday 20:00 in summer time (UTC+3)", () => {
    expect(israelLocalToDate("2026-10-12T20:00")?.toISOString()).toBe("2026-10-12T17:00:00.000Z");
  });

  it("reads Monday 20:00 in winter time (UTC+2)", () => {
    expect(israelLocalToDate("2026-11-09T20:00")?.toISOString()).toBe("2026-11-09T18:00:00.000Z");
  });

  it("round-trips across both DST changes", () => {
    for (const local of [
      "2026-03-26T23:30",
      "2026-03-27T03:30",
      "2026-10-24T23:30",
      "2026-10-25T03:30",
      "2026-12-31T23:59",
    ]) {
      expect(dateToIsraelLocal(israelLocalToDate(local)!)).toBe(local);
    }
  });

  it("refuses an impossible or malformed time instead of storing another one", () => {
    for (const bad of ["2026-02-30T20:00", "2026-10-12T24:00", "2026-10-12 20:00", "20:00", ""]) {
      expect(israelLocalToDate(bad)).toBeNull();
    }
  });
});

describe("which days the form asks about", () => {
  const days = [
    { id: "a", date: "2026-10-09" },
    { id: "b", date: "2026-10-13" },
    { id: "c", date: "2026-10-16" },
    { id: "d", date: "2026-10-20" },
  ];

  it("a camp asks about every day from today on, including today", () => {
    expect(formDays(days, "camp", "2026-10-13").map((d) => d.id)).toEqual(["b", "c", "d"]);
  });

  it("a recurring event asks about the coming week only", () => {
    expect(formDays(days, "recurring", "2026-10-12").map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("asks about nothing once the event is over", () => {
    expect(formDays(days, "camp", "2026-10-21")).toEqual([]);
  });
});

describe("equipment", () => {
  it("trims, drops empties and repeats", () => {
    expect(normalizeEquipment([" כובע ", "", "כובע", "מים"])).toEqual(["כובע", "מים"]);
  });

  it("refuses something that is not a list of short strings", () => {
    expect(normalizeEquipment("כובע")).toBeNull();
    expect(normalizeEquipment([1])).toBeNull();
    expect(normalizeEquipment(["x".repeat(61)])).toBeNull();
  });
});

describe("the staff's settings", () => {
  const base = { autoApprove: true, equipment: [] };

  it("defaults to no cap and no deadline", () => {
    const r = parseFormSettings(base);
    expect(r.ok && r.value).toMatchObject({ capacity: null, closesAt: null, autoApprove: true });
  });

  it("stores the deadline as the instant it is in Israel", () => {
    const r = parseFormSettings({ ...base, closesAt: "2026-10-12T20:00" });
    expect(r.ok && r.value.closesAt?.toISOString()).toBe("2026-10-12T17:00:00.000Z");
  });

  it.each([
    [{ ...base, capacity: 0 }],
    [{ ...base, capacity: 2.5 }],
    [{ ...base, closesAt: "tomorrow" }],
    [{ equipment: [] }],
    [{ ...base, dayEquipment: { "not an id": ["x"] } }],
  ])("refuses %j", (body) => {
    expect(parseFormSettings(body).ok).toBe(false);
  });
});

// ── A submission ────────────────────────────────────────────────────────────

const DAYS = ["d1", "d2"];

function child(over: Record<string, unknown> = {}) {
  return {
    participantId: ID,
    parentName: "דנה כהן",
    parentPhone: "050-123-4567",
    dismissal: "escort",
    pickup: { name: "סבתא רות", relation: "סבתא", phone: "052 765 4321" },
    days: [
      { eventDayId: "d1", coming: true, bringsFood: false },
      { eventDayId: "d2", coming: false },
    ],
    note: "",
    equipmentAck: true,
    ...over,
  };
}

function parse(children: unknown[], equipmentRequired = true) {
  return parseSubmission({ children }, DAYS, { equipmentRequired });
}

describe("parsing a submission", () => {
  it("reads a full child picked from the list", () => {
    const r = parse([child()]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.children[0]).toMatchObject({
      child: { kind: "existing", participantId: ID },
      parentPhone: "0501234567",
      dismissal: "escort",
      pickup: { name: "סבתא רות", phone: "0527654321" },
      days: { d1: { coming: true, bringsFood: false }, d2: { coming: false, bringsFood: null } },
    });
  });

  it("reads a new child typed in, with name and grade", () => {
    const r = parse([child({ participantId: undefined, newChild: { name: " נועה  לוי ", grade: "ב'" } })]);
    expect(r.ok && r.children[0].child).toEqual({ kind: "new", name: "נועה לוי", grade: "ב'" });
  });

  it("takes siblings as separate, complete entries", () => {
    const r = parse([child(), child({ participantId: ID2, dismissal: "alone", pickup: undefined })]);
    expect(r.ok && r.children.map((c) => c.dismissal)).toEqual(["escort", "alone"]);
    expect(r.ok && r.children[1].pickup).toBeNull();
  });

  it.each([
    ["no children", []],
    ["the same child twice", [child(), child()]],
    ["too many children", Array.from({ length: MAX_CHILDREN_PER_SUBMISSION + 1 }, (_, i) =>
      child({ participantId: `ckxyz00000000000000000${10 + i}` }))],
    ["an id that is not an id", [child({ participantId: "1 OR 1=1" })]],
    ["neither a pick nor a name", [child({ participantId: undefined })]],
    ["a new child with no grade", [child({ participantId: undefined, newChild: { name: "נועה" } })]],
    ["no parent name", [child({ parentName: " " })]],
    ["a phone that cannot be dialled", [child({ parentPhone: "12" })]],
    ["no going-home answer", [child({ dismissal: undefined })]],
    ["somebody collecting, but no phone", [child({ pickup: { name: "סבתא" } })]],
    ["a day left unanswered", [child({ days: [{ eventDayId: "d1", coming: false }] })]],
    ["a day the form did not offer", [child({ days: [
      { eventDayId: "d1", coming: false },
      { eventDayId: "d2", coming: false },
      { eventDayId: "d9", coming: true, bringsFood: true },
    ] })]],
    ["coming, but no food answer", [child({ days: [
      { eventDayId: "d1", coming: true },
      { eventDayId: "d2", coming: false },
    ] })]],
    ["the equipment list not confirmed", [child({ equipmentAck: false })]],
    ["a note longer than the cap", [child({ note: "x".repeat(301) })]],
  ])("refuses the whole submission for %s", (_why, children) => {
    expect(parse(children as unknown[]).ok).toBe(false);
  });

  it("does not ask to confirm an equipment list that is empty", () => {
    expect(parse([child({ equipmentAck: false })], false).ok).toBe(true);
  });

  it("says which sibling an error is about", () => {
    const r = parse([child(), child({ participantId: ID2, parentPhone: "" })]);
    expect(!r.ok && r.error).toMatch(/^ילד\/ה 2/);
  });
});

// ── What waits for an adult ─────────────────────────────────────────────────

function entry(over: Partial<ChildSubmission> = {}): ChildSubmission {
  return {
    child: { kind: "existing", participantId: ID },
    parentName: "דנה",
    parentPhone: "0501234567",
    dismissal: "escort",
    pickup: { name: "סבתא רות", relation: "סבתא", phone: "0527654321" },
    days: { d1: { coming: true, bringsFood: false } },
    note: null,
    equipmentAck: true,
    ...over,
  };
}

const stored = {
  defaultDismissal: "escort",
  parentPhone: "050-123-4567",
  authorizations: [{ name: "סבתא רות", phone: "052-765-4321" }],
};

describe("what waits for an adult", () => {
  it("nothing, when the answers are what is already on file", () => {
    expect(reviewFor(entry(), stored)).toEqual({ reasons: [], tightenToEscort: false });
  });

  it("a request to go home alone", () => {
    expect(reviewFor(entry({ dismissal: "alone", pickup: null }), stored).reasons).toEqual([
      "dismissal_alone",
    ]);
  });

  it("someone new collecting", () => {
    const r = reviewFor(entry({ pickup: { name: "דוד", relation: null, phone: "0541111111" } }), stored);
    expect(r.reasons).toEqual(["new_pickup"]);
  });

  it("the same name with a different phone counts as someone new", () => {
    const r = reviewFor(entry({ pickup: { name: "סבתא רות", relation: null, phone: "0549999999" } }), stored);
    expect(r.reasons).toEqual(["new_pickup"]);
  });

  // The hole the 07.10 review closed: anyone in the group can pick anyone's
  // child and type their own number.
  it("a phone that is not the one on file — and it is never written through", () => {
    expect(reviewFor(entry({ parentPhone: "0539999999" }), stored).reasons).toEqual([
      "contact_differs",
    ]);
    expect(reviewFor(entry(), { ...stored, parentPhone: null }).reasons).toEqual([
      "contact_differs",
    ]);
  });

  it("everything about a new child", () => {
    expect(
      reviewFor(entry({ child: { kind: "new", name: "נועה", grade: "א" } }), null).reasons,
    ).toEqual(["new_child", "new_pickup"]);
    expect(
      reviewFor(entry({ child: { kind: "new", name: "נועה", grade: "א" }, dismissal: "alone", pickup: null }), null)
        .reasons,
    ).toEqual(["new_child", "dismissal_alone"]);
  });

  it("tightens 'alone' to 'escort' without waiting — that is the safe direction", () => {
    const r = reviewFor(entry(), { ...stored, defaultDismissal: "alone" });
    expect(r.tightenToEscort).toBe(true);
    expect(r.reasons).not.toContain("dismissal_alone");
  });
});

// ── Status, the cap and the waiting list ────────────────────────────────────

const open = {
  isNew: false,
  autoApprove: true,
  capacity: null,
  placesTaken: 0,
  waitlistAhead: 0,
  coming: true,
  alreadyHoldsPlace: false,
};

describe("the status a submission lands in", () => {
  it("approved straight away by default", () => {
    expect(decideStatus(open)).toBe("approved");
  });

  it("pending when the event wants manual approval", () => {
    expect(decideStatus({ ...open, autoApprove: false })).toBe("pending");
  });

  it("a new child always waits, even with automatic approval", () => {
    expect(decideStatus({ ...open, isNew: true })).toBe("pending");
  });

  it("a full event is a waiting list, not a refusal", () => {
    expect(decideStatus({ ...open, capacity: 10, placesTaken: 10 })).toBe("waitlist");
    expect(decideStatus({ ...open, capacity: 10, placesTaken: 10, isNew: true })).toBe("waitlist");
  });

  it("nobody jumps the waiting list when a place frees up", () => {
    expect(decideStatus({ ...open, capacity: 10, placesTaken: 9, waitlistAhead: 1 })).toBe("waitlist");
  });

  it("a family changing their answers keeps their place, even when the event is full", () => {
    expect(
      decideStatus({ ...open, capacity: 10, placesTaken: 10, alreadyHoldsPlace: true }),
    ).toBe("approved");
  });

  it("'not coming on any day' never waits for a place", () => {
    expect(decideStatus({ ...open, capacity: 10, placesTaken: 10, coming: false })).toBe("approved");
  });

  it("tells the parent only 'received' or 'waiting list'", () => {
    expect(REGISTRATION_STATUSES.map(parentOutcome)).toEqual([
      "received",
      "received",
      "waitlist",
      "received",
    ]);
  });
});

describe("ids from an open endpoint", () => {
  it("accepts a cuid and nothing else", () => {
    expect(isRecordId(ID)).toBe(true);
    for (const bad of ["", "abc", "'; drop table", "C".repeat(25), null, 1]) {
      expect(isRecordId(bad)).toBe(false);
    }
  });
});

// ── The expected number (src/lib/parents.ts) ────────────────────────────────

describe("expected head count, with and without registration", () => {
  it("without registration, silence means coming (item 5)", () => {
    expect(expectedHeadcount({ rostered: 50, coming: 3, notComing: 4, byRegistration: false }))
      .toEqual({ expected: 46, byRegistration: false });
  });

  it("without registration, unknown until someone answers", () => {
    expect(expectedHeadcount({ rostered: 50, coming: 0, notComing: 0, byRegistration: false }).expected)
      .toBeNull();
  });

  // The 07.10 review: fifty children who had not registered by Monday evening
  // are not fifty lunches.
  it("with registration, only the children who registered are expected", () => {
    expect(expectedHeadcount({ rostered: 50, coming: 31, notComing: 4, byRegistration: true }))
      .toEqual({ expected: 31, byRegistration: true });
  });

  it("with registration, nobody registered yet is zero, not 'unknown'", () => {
    expect(expectedHeadcount({ rostered: 50, coming: 0, notComing: 0, byRegistration: true }).expected)
      .toBe(0);
  });

  it("expectedCount follows the same two rules", () => {
    const ids = ["a", "b", "c", "d"];
    const answers = [
      { participantId: "a", coming: true },
      { participantId: "b", coming: false },
    ];
    expect(expectedCount(ids, answers).expected).toBe(3);
    expect(expectedCount(ids, answers, { byRegistration: true }).expected).toBe(1);
  });
});
