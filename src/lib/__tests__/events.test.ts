import { describe, expect, it } from "vitest";
import { generateEventDates } from "../events";

// 2026-07-01 is a Wednesday, so this week runs Wed–Thu–Fri–Sat–Sun.
const WED = "2026-07-01";
const SUN = "2026-07-05";

describe("generateEventDates", () => {
  it("skips Friday and Saturday by default", () => {
    expect(generateEventDates(WED, SUN, false, false)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-05",
    ]);
  });

  it("includes the weekend days when asked", () => {
    expect(generateEventDates(WED, SUN, true, true)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
    expect(generateEventDates(WED, SUN, true, false)).toContain("2026-07-03");
    expect(generateEventDates(WED, SUN, true, false)).not.toContain(
      "2026-07-04",
    );
  });

  it("covers a single-day event", () => {
    expect(generateEventDates(WED, WED, false, false)).toEqual([WED]);
  });

  it("returns nothing for an inverted or invalid range", () => {
    expect(generateEventDates(SUN, WED, false, false)).toEqual([]);
    expect(generateEventDates("nope", SUN, false, false)).toEqual([]);
  });

  it("returns nothing when the range is only excluded weekend days", () => {
    expect(generateEventDates("2026-07-03", "2026-07-04", false, false)).toEqual(
      [],
    );
  });

  it("caps a runaway range at 366 days", () => {
    expect(
      generateEventDates("2020-01-01", "2030-01-01", true, true),
    ).toHaveLength(366);
  });
});
