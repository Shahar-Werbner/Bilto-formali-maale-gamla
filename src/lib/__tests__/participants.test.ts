import { describe, expect, it } from "vitest";
import {
  normalizeName,
  normalizePhone,
  parseRoster,
  partitionByExisting,
  splitByExistingKeys,
} from "../participants";

describe("parseRoster", () => {
  it("reads the plain case: one name per line", () => {
    const { rows, skipped } = parseRoster("דנה כהן\nאבי לוי\n");
    expect(rows.map((r) => r.name)).toEqual(["דנה כהן", "אבי לוי"]);
    expect(rows[0].grade).toBeNull();
    expect(skipped).toEqual([]);
  });

  it("reads name, grade, parent and phone", () => {
    const { rows } = parseRoster("דנה כהן, ג׳, רותי כהן, 050-123-4567");
    expect(rows[0]).toEqual({
      name: "דנה כהן",
      grade: "ג׳",
      parentName: "רותי כהן",
      parentPhone: "0501234567",
    });
  });

  it("accepts tabs and semicolons, which is what a paste from Sheets gives", () => {
    expect(parseRoster("דנה\tג׳").rows[0].grade).toBe("ג׳");
    expect(parseRoster("דנה;ג׳").rows[0].grade).toBe("ג׳");
  });

  it("handles a quoted field containing a comma", () => {
    const { rows } = parseRoster('"כהן, דנה", ג׳');
    expect(rows[0].name).toBe("כהן, דנה");
    expect(rows[0].grade).toBe("ג׳");
  });

  it("handles an escaped quote inside a quoted field", () => {
    expect(parseRoster('"דנה ""דני"" כהן"').rows[0].name).toBe('דנה "דני" כהן');
  });

  it("drops a pasted header row without counting it as an error", () => {
    const { rows, skipped } = parseRoster("שם, כיתה\nדנה, ג׳");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("דנה");
    expect(skipped).toEqual([]);
  });

  it("ignores blank lines but reports a line it could not use", () => {
    const { rows, skipped } = parseRoster("דנה\n\n   \n, ג׳\nאבי");
    expect(rows.map((r) => r.name)).toEqual(["דנה", "אבי"]);
    expect(skipped).toEqual([4]); // the line that had a grade but no name
  });

  it("collapses runs of whitespace in a name", () => {
    expect(parseRoster("  דנה   כהן  ").rows[0].name).toBe("דנה כהן");
  });

  it("returns nothing for empty input", () => {
    expect(parseRoster("").rows).toEqual([]);
    expect(parseRoster("\n\n").rows).toEqual([]);
  });
});

describe("normalizePhone", () => {
  it("keeps the digits and drops the decoration", () => {
    expect(normalizePhone("050-123-4567")).toBe("0501234567");
    expect(normalizePhone("050 123 4567")).toBe("0501234567");
    expect(normalizePhone("(050) 1234567")).toBe("0501234567");
  });

  it("keeps a leading plus for an international number", () => {
    expect(normalizePhone("+972-50-1234567")).toBe("+972501234567");
  });

  it("returns null when there is no number in there", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("אין")).toBeNull();
  });
});

describe("normalizeName", () => {
  it("treats spelling variants of the same child as one", () => {
    expect(normalizeName("דנה  כהן")).toBe(normalizeName("דנה כהן"));
    expect(normalizeName("דנה כהן ")).toBe(normalizeName("דנה כהן"));
    // Apostrophe variants: straight, curly, and the Hebrew geresh.
    expect(normalizeName("ג'ניפר")).toBe(normalizeName("ג’ניפר"));
  });

  it("does not collapse genuinely different names", () => {
    expect(normalizeName("דנה כהן")).not.toBe(normalizeName("דנה לוי"));
  });
});

describe("partitionByExisting", () => {
  const rows = parseRoster("דנה כהן\nאבי לוי\nדנה  כהן").rows;

  it("separates children who are already in the system", () => {
    const { fresh, duplicate } = partitionByExisting(rows, ["דנה כהן"]);
    expect(fresh.map((r) => r.name)).toEqual(["אבי לוי"]);
    expect(duplicate).toHaveLength(2);
  });

  it("catches a name repeated within the paste itself", () => {
    const { fresh, duplicate } = partitionByExisting(rows, []);
    expect(fresh.map((r) => r.name)).toEqual(["דנה כהן", "אבי לוי"]);
    expect(duplicate.map((r) => r.name)).toEqual(["דנה  כהן".replace(/\s+/g, " ")]);
  });

  it("importing the same list twice adds nobody the second time", () => {
    const first = partitionByExisting(rows, []);
    const names = first.fresh.map((r) => r.name);
    const second = partitionByExisting(rows, names);
    expect(second.fresh).toEqual([]);
  });
});

// Merging one child's record into another has to carry the rows that hang off
// it. Three of those tables are unique per (day, child), so a row for a day the
// surviving record already covers cannot be reassigned — it would fail the
// constraint and take the whole merge down with it.
describe("splitByExistingKeys", () => {
  const key = (r: { day: string }) => r.day;

  it("moves the rows the surviving record has no row for", () => {
    const { move, drop } = splitByExistingKeys(
      [{ day: "mon" }, { day: "tue" }],
      key,
      ["wed"],
    );
    expect(move.map((r) => r.day)).toEqual(["mon", "tue"]);
    expect(drop).toEqual([]);
  });

  it("drops the duplicate where both records cover the same day", () => {
    const { move, drop } = splitByExistingKeys(
      [{ day: "mon" }, { day: "tue" }],
      key,
      ["mon"],
    );
    // The survivor's row for Monday stands — it is the one the team has been
    // looking at — so the duplicate is dropped rather than overwriting it.
    expect(move.map((r) => r.day)).toEqual(["tue"]);
    expect(drop.map((r) => r.day)).toEqual(["mon"]);
  });

  it("catches a repeat within the moving rows themselves", () => {
    const { move, drop } = splitByExistingKeys(
      [{ day: "mon" }, { day: "mon" }],
      key,
      [],
    );
    expect(move).toHaveLength(1);
    expect(drop).toHaveLength(1);
  });

  it("moves everything when the surviving record holds nothing", () => {
    const { move, drop } = splitByExistingKeys([{ day: "mon" }], key, []);
    expect(move).toHaveLength(1);
    expect(drop).toEqual([]);
  });

  // Pickup authorizations have no unique constraint, so the key is the person
  // rather than the day: the same grandmother on both records should not end up
  // listed twice, but a different person must come across.
  it("keys on the person when merging who may collect a child", () => {
    const authKey = (a: { name: string }) => normalizeName(a.name);
    const { move, drop } = splitByExistingKeys(
      [{ name: "סבתא  רחל" }, { name: "שכנה" }],
      authKey,
      [normalizeName("סבתא רחל")],
    );
    expect(move.map((a) => a.name)).toEqual(["שכנה"]);
    expect(drop.map((a) => a.name)).toEqual(["סבתא  רחל"]);
  });
});
