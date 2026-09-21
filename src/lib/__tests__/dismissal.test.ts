import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISMISSAL,
  dismissalExceptionReason,
  dismissalMethodOf,
  dismissalState,
  isAuthorizedName,
  isDismissalException,
  isDismissalMethod,
  splitAuthorizationsForMerge,
  type Authorization,
} from "../dismissal";

const MOM: Authorization = { name: "רותי כהן" };
const GRANDMA: Authorization = { name: "שרה לוי" };

describe("the standing instruction", () => {
  // The single most important line in this file. A child whose record says
  // nothing waits for an adult; we never infer that they walk home.
  it("defaults to waiting for an adult", () => {
    expect(DEFAULT_DISMISSAL).toBe("escort");
  });

  it("treats a missing or unrecognised instruction as waiting for an adult", () => {
    for (const bad of [null, undefined, "", "ALONE", "walk", 1, {}]) {
      expect(dismissalMethodOf(bad)).toBe("escort");
    }
    expect(dismissalMethodOf("alone")).toBe("alone");
  });

  it("accepts only the two methods the system knows", () => {
    expect(isDismissalMethod("alone")).toBe(true);
    expect(isDismissalMethod("escort")).toBe(true);
    for (const bad of ["Alone", "", null, undefined, {}]) {
      expect(isDismissalMethod(bad)).toBe(false);
    }
  });
});

describe("what the screen shows for a child", () => {
  it("shows a child with no record as waiting", () => {
    expect(dismissalState(null)).toBe("waiting");
  });

  // Including a child whose standing instruction is "alone": nobody has
  // confirmed they actually left, so they are still on the list of people to
  // account for at the end of the day.
  it("shows a child with no record as waiting even when they walk home alone", () => {
    expect(dismissalState(null)).toBe("waiting");
  });

  it("tells going home alone apart from being collected", () => {
    expect(dismissalState({ method: "alone" })).toBe("alone");
    expect(
      dismissalState({ method: "escort", pickedUpByName: "רותי כהן" }),
    ).toBe("collected");
  });
});

describe("matching a name against the pickup list", () => {
  it("matches the way the roster matches two spellings of one name", () => {
    expect(isAuthorizedName("רותי כהן", [MOM])).toBe(true);
    expect(isAuthorizedName("  רותי   כהן ", [MOM])).toBe(true);
    expect(isAuthorizedName('רותי כהן"', [MOM])).toBe(true);
  });

  it("does not match a different person, or nobody at all", () => {
    expect(isAuthorizedName("דנה כהן", [MOM])).toBe(false);
    expect(isAuthorizedName("", [MOM])).toBe(false);
    expect(isAuthorizedName("רותי כהן", [])).toBe(false);
  });
});

// ── The gate ────────────────────────────────────────────────────────────────
// Owner's decision, 19.09: a youth counselor may record a dismissal that
// matches the list; anything off it needs an adult.
describe("which dismissals a youth counselor may record alone", () => {
  const waitsForAdult = { defaultDismissal: "escort", authorizations: [MOM, GRANDMA] } as const;
  const walksHome = { defaultDismissal: "alone", authorizations: [] } as const;

  it("lets the routine case through: a name on the list", () => {
    expect(
      isDismissalException(
        { method: "escort", pickedUpByName: "שרה לוי" },
        waitsForAdult,
      ),
    ).toBe(false);
  });

  it("lets a child whose standing instruction is 'alone' go alone", () => {
    expect(isDismissalException({ method: "alone" }, walksHome)).toBe(false);
  });

  it("stops a name that is not on the list", () => {
    expect(
      isDismissalException(
        { method: "escort", pickedUpByName: "השכן" },
        waitsForAdult,
      ),
    ).toBe(true);
  });

  it("stops a collection with nobody named", () => {
    // "Collected" without a name records nothing about who took the child.
    expect(
      isDismissalException({ method: "escort", pickedUpByName: "" }, waitsForAdult),
    ).toBe(true);
  });

  // The worst failure mode of the three: a six-year-old sent out of the gate
  // on their own against what their record says.
  it("stops a child being sent home alone against their standing instruction", () => {
    expect(isDismissalException({ method: "alone" }, waitsForAdult)).toBe(true);
  });

  it("stops a one-off change even when the name is on the list", () => {
    expect(
      isDismissalException(
        { method: "escort", pickedUpByName: "רותי כהן", note: "היום סבתא" },
        waitsForAdult,
      ),
    ).toBe(true);
  });

  it("ignores a note that is only whitespace", () => {
    expect(
      isDismissalException(
        { method: "escort", pickedUpByName: "רותי כהן", note: "   " },
        waitsForAdult,
      ),
    ).toBe(false);
  });

  it("explains itself in words a fifteen-year-old can act on", () => {
    const reason = dismissalExceptionReason(
      { method: "escort", pickedUpByName: "השכן" },
      waitsForAdult,
    );
    expect(reason).toContain("מורשי האיסוף");
    expect(
      dismissalExceptionReason(
        { method: "escort", pickedUpByName: "רותי כהן" },
        waitsForAdult,
      ),
    ).toBeNull();
  });
});

// A one-off change is a record of one day. It must not quietly become the
// child's standing arrangement — that is how a temporary "today grandma"
// becomes a permanent authorization nobody decided on.
describe("a one-off change does not touch the standing instruction", () => {
  it("leaves the standing instruction and list untouched", () => {
    const context = {
      defaultDismissal: "escort",
      authorizations: [MOM],
    } as const;
    isDismissalException(
      { method: "escort", pickedUpByName: "השכן", note: "היום השכן" },
      context,
    );
    expect(context.defaultDismissal).toBe("escort");
    expect(context.authorizations).toEqual([MOM]);
    // ...and the same exception still applies the next time that name appears.
    expect(
      isDismissalException({ method: "escort", pickedUpByName: "השכן" }, context),
    ).toBe(true);
  });
});

// ── Folding two records of one child together ──────────────────────────────
//
// This one was not written from the spec. It was written after running a merge
// against a real database and watching "רותי כהן" appear twice on the surviving
// child: the old rule keyed on name *plus* phone, so the same mother entered
// once with a number and once without counted as two people.
describe("merging pickup lists", () => {
  it("treats one side's missing phone as the same person, not a second one", () => {
    const { move, drop } = splitAuthorizationsForMerge(
      [{ id: "a", name: "רותי כהן", phone: null }],
      [{ name: "רותי כהן", phone: "0501234567" }],
    );
    expect(move).toEqual([]);
    expect(drop.map((a) => a.id)).toEqual(["a"]);
  });

  it("carries across anyone the survivor does not already have", () => {
    const { move } = splitAuthorizationsForMerge(
      [{ id: "a", name: "דוד כהן", phone: null }],
      [{ name: "רותי כהן", phone: "0501234567" }],
    );
    // Dropping this would quietly narrow who may collect the child — the one
    // direction this function must never fail in.
    expect(move.map((a) => a.id)).toEqual(["a"]);
  });

  it("keeps both when the same name carries two different numbers", () => {
    // One person with a new number, or two people with one name. Either way,
    // discarding a number somebody deliberately typed is not ours to do.
    const { move, drop } = splitAuthorizationsForMerge(
      [{ id: "a", name: "רותי כהן", phone: "052-999-8888" }],
      [{ name: "רותי כהן", phone: "0501234567" }],
    );
    expect(move.map((a) => a.id)).toEqual(["a"]);
    expect(drop).toEqual([]);
  });

  it("matches the same spelling differences the roster does", () => {
    const { drop } = splitAuthorizationsForMerge(
      [{ id: "a", name: "  רותי   כהן" }],
      [{ name: 'רותי כהן"' }],
    );
    expect(drop.map((a) => a.id)).toEqual(["a"]);
  });

  it("does not let the duplicate's own repeats through", () => {
    const { move, drop } = splitAuthorizationsForMerge(
      [
        { id: "a", name: "שרה לוי" },
        { id: "b", name: "שרה לוי" },
      ],
      [],
    );
    expect(move.map((a) => a.id)).toEqual(["a"]);
    expect(drop.map((a) => a.id)).toEqual(["b"]);
  });

  it("normalises the phone before comparing it", () => {
    const { drop } = splitAuthorizationsForMerge(
      [{ id: "a", name: "רותי כהן", phone: "050-123-4567" }],
      [{ name: "רותי כהן", phone: "0501234567" }],
    );
    expect(drop.map((a) => a.id)).toEqual(["a"]);
  });
});
