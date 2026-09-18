import { describe, expect, it } from "vitest";
import {
  MAX_EVENT_RANGE_DAYS,
  generateEventDays,
  hoursBetween,
  rangeDayCount,
  type GenerateEventDaysInput,
} from "../events";

// 2026-07-01 is a Wednesday, so this week runs Wed–Thu–Fri–Sat–Sun.
const WED = "2026-07-01";
const SUN = "2026-07-05";

const TUESDAY = 2;
const FRIDAY = 5;

function camp(over: Partial<GenerateEventDaysInput> = {}) {
  return generateEventDays({
    startDate: WED,
    endDate: SUN,
    kind: "camp",
    ...over,
  });
}

function dates(days: { date: string }[]) {
  return days.map((d) => d.date);
}

describe("generateEventDays — camp", () => {
  it("skips Friday and Saturday by default", () => {
    expect(dates(camp())).toEqual(["2026-07-01", "2026-07-02", "2026-07-05"]);
  });

  it("includes the weekend days when asked", () => {
    expect(dates(camp({ includeFriday: true, includeSaturday: true }))).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
    const fridayOnly = dates(camp({ includeFriday: true }));
    expect(fridayOnly).toContain("2026-07-03");
    expect(fridayOnly).not.toContain("2026-07-04");
  });

  it("covers a single-day event", () => {
    expect(dates(camp({ endDate: WED }))).toEqual([WED]);
  });

  it("returns nothing for an inverted or invalid range", () => {
    expect(camp({ startDate: SUN, endDate: WED })).toEqual([]);
    expect(camp({ startDate: "nope" })).toEqual([]);
  });

  it("returns nothing when the range is only excluded weekend days", () => {
    expect(camp({ startDate: "2026-07-03", endDate: "2026-07-04" })).toEqual([]);
  });

  it("puts the event's default hours on every generated day", () => {
    const days = camp({ defaultStartTime: "09:00", defaultEndTime: "13:00" });
    expect(days).toHaveLength(3);
    for (const d of days) {
      expect(d.startTime).toBe("09:00");
      expect(d.endTime).toBe("13:00");
    }
  });

  it("leaves hours null when the event has none, rather than inventing them", () => {
    expect(camp()[0]).toEqual({
      date: "2026-07-01",
      startTime: null,
      endTime: null,
    });
  });

  it("ignores a malformed default time instead of storing it", () => {
    const days = camp({ defaultStartTime: "9:00", defaultEndTime: "25:61" });
    expect(days[0].startTime).toBeNull();
    expect(days[0].endTime).toBeNull();
  });
});

describe("generateEventDays — recurring", () => {
  // The real operation: every Tuesday 16:00–19:00 and every Friday 09:00–13:00,
  // through a school year.
  const YEAR: GenerateEventDaysInput = {
    startDate: "2026-09-01",
    endDate: "2027-06-30",
    kind: "recurring",
    weekdays: [
      { weekday: TUESDAY, startTime: "16:00", endTime: "19:00" },
      { weekday: FRIDAY, startTime: "09:00", endTime: "13:00" },
    ],
  };

  it("generates only the chosen weekdays, each with its own hours", () => {
    const days = generateEventDays(YEAR);
    expect(days.length).toBeGreaterThan(80);

    for (const d of days) {
      const weekday = new Date(`${d.date}T00:00:00.000Z`).getUTCDay();
      expect([TUESDAY, FRIDAY]).toContain(weekday);
      if (weekday === TUESDAY) {
        expect(d.startTime).toBe("16:00");
        expect(d.endTime).toBe("19:00");
      } else {
        expect(d.startTime).toBe("09:00");
        expect(d.endTime).toBe("13:00");
      }
    }

    // No day of any other weekday sneaks in, and none is missing: Sep 1 2026 is
    // a Tuesday, so the year opens on one.
    expect(days[0]).toEqual({
      date: "2026-09-01",
      startTime: "16:00",
      endTime: "19:00",
    });
    expect(days[1]).toEqual({
      date: "2026-09-04",
      startTime: "09:00",
      endTime: "13:00",
    });
  });

  it("ignores the camp weekend checkboxes — the pattern decides", () => {
    const withCheckboxes = generateEventDays({
      ...YEAR,
      includeFriday: false,
      includeSaturday: false,
    });
    expect(withCheckboxes).toEqual(generateEventDays(YEAR));
    expect(withCheckboxes.length).toBeGreaterThan(0);
  });

  it("returns nothing when no weekday was chosen — never 'every day'", () => {
    expect(generateEventDays({ ...YEAR, weekdays: [] })).toEqual([]);
    expect(generateEventDays({ ...YEAR, weekdays: undefined })).toEqual([]);
  });

  it("drops a weekday row with an impossible weekday or time", () => {
    const days = generateEventDays({
      ...YEAR,
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      weekdays: [
        { weekday: TUESDAY, startTime: "16:00", endTime: "19:00" },
        { weekday: 9, startTime: "10:00", endTime: "12:00" },
        { weekday: FRIDAY, startTime: "nope", endTime: "13:00" },
      ],
    });
    expect(dates(days)).toEqual(["2026-09-01"]);
  });
});

describe("generateEventDays — range cap", () => {
  it("accepts a full school year", () => {
    expect(
      generateEventDays({
        startDate: "2026-09-01",
        endDate: "2027-06-30",
        kind: "camp",
        includeFriday: true,
        includeSaturday: true,
      }).length,
    ).toBe(rangeDayCount("2026-09-01", "2027-06-30"));
  });

  it("refuses a range over the cap outright instead of truncating it", () => {
    expect(
      generateEventDays({
        startDate: "2020-01-01",
        endDate: "2030-01-01",
        kind: "camp",
        includeFriday: true,
        includeSaturday: true,
      }),
    ).toEqual([]);
  });

  it("accepts exactly the cap and refuses one day more", () => {
    const start = "2026-01-01";
    const atCap = new Date(Date.UTC(2026, 0, MAX_EVENT_RANGE_DAYS))
      .toISOString()
      .slice(0, 10);
    const overCap = new Date(Date.UTC(2026, 0, MAX_EVENT_RANGE_DAYS + 1))
      .toISOString()
      .slice(0, 10);

    expect(rangeDayCount(start, atCap)).toBe(MAX_EVENT_RANGE_DAYS);
    expect(
      generateEventDays({
        startDate: start,
        endDate: atCap,
        kind: "camp",
        includeFriday: true,
        includeSaturday: true,
      }),
    ).toHaveLength(MAX_EVENT_RANGE_DAYS);
    expect(
      generateEventDays({
        startDate: start,
        endDate: overCap,
        kind: "camp",
        includeFriday: true,
        includeSaturday: true,
      }),
    ).toEqual([]);
  });
});

describe("rangeDayCount", () => {
  it("counts both ends of the range", () => {
    expect(rangeDayCount(WED, WED)).toBe(1);
    expect(rangeDayCount(WED, SUN)).toBe(5);
  });

  it("is null for an invalid or inverted range", () => {
    expect(rangeDayCount(SUN, WED)).toBeNull();
    expect(rangeDayCount("nope", SUN)).toBeNull();
    expect(rangeDayCount("2026-02-29", SUN)).toBeNull();
  });
});

describe("hoursBetween", () => {
  it("measures a session", () => {
    expect(hoursBetween("16:00", "19:00")).toBe(3);
    expect(hoursBetween("09:00", "13:00")).toBe(4);
    expect(hoursBetween("08:30", "12:00")).toBe(3.5);
    expect(hoursBetween("08:00", "08:20")).toBe(0.33);
  });

  // Item 6 adds these up into somebody's monthly pay. A bad row must count as
  // zero, never as a negative that quietly eats hours from the rest of the month.
  it("is 0 for a missing, malformed or inverted pair", () => {
    expect(hoursBetween(null, "19:00")).toBe(0);
    expect(hoursBetween("16:00", null)).toBe(0);
    expect(hoursBetween(undefined, undefined)).toBe(0);
    expect(hoursBetween("", "")).toBe(0);
    expect(hoursBetween("19:00", "16:00")).toBe(0);
    expect(hoursBetween("16:00", "16:00")).toBe(0);
    expect(hoursBetween("9:00", "13:00")).toBe(0);
    expect(hoursBetween("24:00", "25:00")).toBe(0);
  });
});
