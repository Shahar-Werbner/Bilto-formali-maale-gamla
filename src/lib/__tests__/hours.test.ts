import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentMonth,
  hoursText,
  isMonth,
  missingHoursAlert,
  monthLabel,
  monthRange,
  sessionsText,
  shiftMonth,
  summarizeMonth,
  totalHours,
  type HoursRow,
} from "../hours";

// A Tuesday session: 16:00–19:00, three hours. The real operation's shape —
// Tuesdays are three hours and Fridays four — so a month of them is the test
// that actually matters.
function row(over: Partial<HoursRow> = {}): HoursRow {
  return {
    userId: "u1",
    userName: "רותם",
    userRole: "youth",
    date: "2026-09-01",
    eventName: "שנת פעילות",
    dayStartTime: "16:00",
    dayEndTime: "19:00",
    startTime: null,
    endTime: null,
    role: null,
    note: null,
    ...over,
  };
}

describe("isMonth", () => {
  it("accepts a calendar month", () => {
    for (const m of ["2026-01", "2026-09", "2026-12"]) {
      expect(isMonth(m)).toBe(true);
    }
  });

  it("rejects anything that is not one", () => {
    // These arrive from a query string, so a wrong shape must not reach a
    // date range — "2026-13" would silently become January 2027.
    for (const bad of [
      "2026-13",
      "2026-00",
      "2026-9",
      "2026-09-01",
      "",
      null,
      undefined,
      2026,
    ]) {
      expect(isMonth(bad)).toBe(false);
    }
  });
});

describe("monthRange", () => {
  it("spans a whole 30-day month", () => {
    expect(monthRange("2026-09")).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
  });

  it("gets the 31-day months and February right", () => {
    expect(monthRange("2026-01")?.end).toBe("2026-01-31");
    expect(monthRange("2026-02")?.end).toBe("2026-02-28");
    // A leap year, which is the case a hand-written table gets wrong.
    expect(monthRange("2028-02")?.end).toBe("2028-02-29");
  });

  it("refuses a month that is not one", () => {
    expect(monthRange("2026-13")).toBeNull();
  });
});

describe("shiftMonth", () => {
  it("steps back and forward", () => {
    expect(shiftMonth("2026-09", -1)).toBe("2026-08");
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
  });

  it("crosses the year boundary in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("currentMonth", () => {
  // Invariant 4. The server runs in UTC and the team is in Israel, so at
  // 00:30 local on the 1st of October the UTC clock still says September —
  // and the report would open on the wrong month exactly when somebody is
  // closing the previous one.
  it("resolves in Asia/Jerusalem, not UTC", () => {
    // 2026-09-30T22:30Z is 2026-10-01 01:30 in Jerusalem (UTC+3).
    expect(currentMonth(new Date("2026-09-30T22:30:00.000Z"))).toBe("2026-10");
  });

  it("stays on the month everywhere in the middle of it", () => {
    expect(currentMonth(new Date("2026-09-15T12:00:00.000Z"))).toBe("2026-09");
  });
});

describe("monthLabel", () => {
  it("names the month in Hebrew", () => {
    expect(monthLabel("2026-09")).toContain("ספטמבר");
    expect(monthLabel("2026-09")).toContain("2026");
  });
});

describe("summarizeMonth", () => {
  // The spec's first test: a whole month has to add up.
  it("sums a whole month of sessions", () => {
    // Four Tuesdays of 3 hours and four Fridays of 4 hours = 28.
    const rows: HoursRow[] = [
      ...["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"].map((date) =>
        row({ date }),
      ),
      ...["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"].map((date) =>
        row({ date, dayStartTime: "08:00", dayEndTime: "12:00" }),
      ),
    ];

    const [person] = summarizeMonth(rows);
    expect(person.totalHours).toBe(28);
    expect(person.dayCount).toBe(8);
    expect(person.missingHoursDays).toBe(0);
    expect(totalHours(summarizeMonth(rows))).toBe(28);
  });

  it("does not let floating point drift into a month's total", () => {
    // 8 × 3.33 hours. Summed naively this lands on 26.639999999999997, and a
    // total that prints 14 decimals is one nobody trusts.
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({
        date: `2026-09-0${i + 1}`,
        dayStartTime: "16:00",
        dayEndTime: "19:20",
      }),
    );
    expect(summarizeMonth(rows)[0].totalHours).toBe(26.64);
  });

  // The spec's second test.
  it("falls back to the session's hours when the shift has none", () => {
    const [person] = summarizeMonth([row()]);
    expect(person.totalHours).toBe(3);
    expect(person.days[0].startTime).toBe("16:00");
    expect(person.days[0].endTime).toBe("19:00");
    expect(person.days[0].overridden).toBe(false);
  });

  it("prefers the shift's own hours when somebody typed an exception", () => {
    // Came an hour late: only exceptions are typed, and this is one.
    const [person] = summarizeMonth([row({ startTime: "17:00" })]);
    expect(person.totalHours).toBe(2);
    expect(person.days[0].overridden).toBe(true);
    // The other end still comes from the session — an exception is one field,
    // not a pair somebody has to retype.
    expect(person.days[0].endTime).toBe("19:00");
  });

  // The spec's third test.
  it("counts an inverted pair as 0, never as a negative", () => {
    const [person] = summarizeMonth([
      row({ startTime: "19:00", endTime: "16:00" }),
    ]);
    expect(person.totalHours).toBe(0);
    expect(person.totalHours).not.toBeLessThan(0);
  });

  it("does not let one bad row eat the rest of the month", () => {
    // The reason hoursBetween answers 0 rather than a negative: a single
    // mistyped pair must not quietly subtract from somebody's pay.
    const rows = [row(), row({ date: "2026-09-08", startTime: "19:00", endTime: "16:00" })];
    const [person] = summarizeMonth(rows);
    expect(person.totalHours).toBe(3);
    expect(person.missingHoursDays).toBe(1);
  });

  it("keeps a session with no hours anywhere visible instead of dropping it", () => {
    // A day whose hours were never set. It is worth nothing, which is exactly
    // why it has to appear: the only place anyone can catch it is this report.
    const [person] = summarizeMonth([
      row({ dayStartTime: null, dayEndTime: null }),
    ]);
    expect(person.dayCount).toBe(1);
    expect(person.days).toHaveLength(1);
    expect(person.totalHours).toBe(0);
    expect(person.missingHoursDays).toBe(1);
    expect(missingHoursAlert(person)).toContain("מפגש אחד");
  });

  it("splits the month per person and sorts people by name", () => {
    const people = summarizeMonth([
      row({ userId: "u2", userName: "תמר" }),
      row({ userId: "u1", userName: "אבי" }),
      row({ userId: "u1", userName: "אבי", date: "2026-09-08" }),
    ]);
    expect(people.map((p) => p.name)).toEqual(["אבי", "תמר"]);
    expect(people[0].dayCount).toBe(2);
    expect(people[1].dayCount).toBe(1);
    expect(totalHours(people)).toBe(9);
  });

  it("puts each person's days in date order whatever order they arrived in", () => {
    const [person] = summarizeMonth([
      row({ date: "2026-09-22" }),
      row({ date: "2026-09-01" }),
      row({ date: "2026-09-15" }),
    ]);
    expect(person.days.map((d) => d.date)).toEqual([
      "2026-09-01",
      "2026-09-15",
      "2026-09-22",
    ]);
  });

  it("is empty for a month with nothing in it", () => {
    expect(summarizeMonth([])).toEqual([]);
    expect(totalHours([])).toBe(0);
  });
});

describe("the Hebrew the screen prints", () => {
  // The lesson item 4 stage B left behind: a string with a number in it is
  // where Hebrew breaks, and no test was looking.
  it("counts one, two and many differently", () => {
    expect(hoursText(1)).toBe("שעה אחת");
    expect(hoursText(2)).toBe("שעתיים");
    expect(hoursText(3.5)).toBe("3.5 שעות");
    expect(sessionsText(1)).toBe("מפגש אחד");
    expect(sessionsText(6)).toBe("6 מפגשים");
  });

  it("writes no ratio with a colon and no ל-<digit>, which reverse in RTL", () => {
    const [person] = summarizeMonth([row(), row({ date: "2026-09-08" })]);
    const lines = [
      hoursText(person.totalHours),
      sessionsText(person.dayCount),
      missingHoursAlert(person) ?? "",
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/\d\s*:\s*\d/);
      expect(line).not.toMatch(/ל-\d/);
    }
  });

  it("says nothing about missing hours when there are none", () => {
    expect(missingHoursAlert(summarizeMonth([row()])[0])).toBeNull();
  });
});

// ── The soft-delete filter the route sweep cannot see ───────────────────────
//
// event-scope.test.ts reads route sources, and this report's query lives in a
// lib so the screen and the .xlsx cannot drift apart. That moves the filter
// out of the sweep's reach, so it is checked here instead.
describe("loadMonthHours scoping", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/hours-query.ts"),
    "utf8",
  );

  it("filters soft-deleted events out of the month (invariant 1)", () => {
    expect(src).toMatch(/LIVE_EVENT/);
    expect(src).toMatch(/@\/lib\/event-scope/);
  });

  it("is the only place either hours route queries shifts", () => {
    // If a route grows its own prisma.shift query, the file and the screen can
    // start disagreeing — and one of them will be the one somebody is paid on.
    for (const rel of [
      "src/app/api/reports/hours/route.ts",
      "src/app/api/reports/hours/export/route.ts",
    ]) {
      const route = readFileSync(join(process.cwd(), rel), "utf8");
      expect(route).not.toMatch(/prisma\./);
      expect(route).toMatch(/loadMonthHours/);
    }
  });
});
