import { describe, expect, it } from "vitest";
import {
  formatDateOnly,
  gradeRank,
  isStatus,
  parseDateOnly,
  sortByGrade,
  todayDateOnly,
} from "../attendance";

describe("parseDateOnly", () => {
  it("parses a YYYY-MM-DD string at midnight UTC", () => {
    expect(parseDateOnly("2026-07-01")?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });

  it("rejects anything that is not a bare calendar date", () => {
    for (const bad of ["2026-7-1", "01/07/2026", "", "2026-07-01T10:00:00Z"]) {
      expect(parseDateOnly(bad)).toBeNull();
    }
  });

  it("round-trips through formatDateOnly", () => {
    expect(formatDateOnly(parseDateOnly("2026-12-31")!)).toBe("2026-12-31");
    expect(formatDateOnly(parseDateOnly("2024-02-29")!)).toBe("2024-02-29");
  });

  it("rejects a day that does not exist rather than rolling it over", () => {
    expect(parseDateOnly("2026-02-29")).toBeNull();
    expect(parseDateOnly("2026-13-01")).toBeNull();
    expect(parseDateOnly("2026-04-31")).toBeNull();
  });
});

describe("todayDateOnly", () => {
  // The regression this guards: the server runs in UTC, so 00:30 in Israel is
  // still "yesterday" there — the app used to open on the wrong day at night.
  it("uses the Israeli calendar day, not the UTC one", () => {
    const justAfterMidnightInIsrael = new Date("2026-07-01T22:30:00.000Z");
    expect(todayDateOnly(justAfterMidnightInIsrael)).toBe("2026-07-02");
  });

  it("agrees with UTC during the day", () => {
    expect(todayDateOnly(new Date("2026-07-01T09:00:00.000Z"))).toBe(
      "2026-07-01",
    );
  });
});

describe("gradeRank", () => {
  it("orders the Hebrew grade letters", () => {
    expect(gradeRank("א'")).toBeLessThan(gradeRank("ב'"));
    expect(gradeRank("ט")).toBeLessThan(gradeRank("י"));
    expect(gradeRank("י")).toBeLessThan(gradeRank("יא"));
    expect(gradeRank("יא")).toBeLessThan(gradeRank("יב"));
  });

  it("ignores a class number suffix", () => {
    expect(gradeRank("ה'2")).toBe(gradeRank("ה"));
  });

  it("sorts missing grades last", () => {
    expect(gradeRank(null)).toBeGreaterThan(gradeRank("יב"));
    expect(gradeRank("")).toBeGreaterThan(gradeRank("יב"));
  });
});

describe("sortByGrade", () => {
  it("sorts by grade, then by name, without mutating the input", () => {
    const list = [
      { name: "דנה", grade: "ג'" },
      { name: "יובל", grade: null },
      { name: "אבי", grade: "א'" },
      { name: "בר", grade: "ג'" },
    ];
    const copy = [...list];
    expect(sortByGrade(list).map((p) => p.name)).toEqual([
      "אבי",
      "בר",
      "דנה",
      "יובל",
    ]);
    expect(list).toEqual(copy);
  });
});

describe("isStatus", () => {
  it("accepts only the three attendance statuses", () => {
    expect(isStatus("present")).toBe(true);
    expect(isStatus("late")).toBe(true);
    expect(isStatus("absent")).toBe(true);
    expect(isStatus("PRESENT")).toBe(false);
    expect(isStatus(undefined)).toBe(false);
  });
});
