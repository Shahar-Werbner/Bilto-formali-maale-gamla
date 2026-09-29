import { describe, expect, it } from "vitest";
import {
  bankForPrompt,
  cleanTags,
  endTimeFrom,
  fitsGrade,
  gradeRangeError,
  gradeRangeLabel,
  matchActivityByName,
  parseActivityInput,
  rankActivities,
  rateBlockReason,
  summarizeRatings,
} from "../activities";
import { systemPrompt } from "../ai-schedule";

const v = (...verdicts: string[]) => verdicts.map((verdict) => ({ verdict }));

describe("summarizeRatings", () => {
  it("counts each verdict", () => {
    const s = summarizeRatings(v("worked", "worked", "flopped", "wrong_age"));
    expect(s).toMatchObject({ worked: 2, flopped: 1, wrongAge: 1, total: 4 });
  });

  it("scores an unrated activity exactly in the middle", () => {
    expect(summarizeRatings([]).score).toBe(0.5);
  });

  it("ignores a verdict it does not know instead of counting it as a success", () => {
    const s = summarizeRatings(v("worked", "amazing", ""));
    expect(s.total).toBe(1);
    expect(s.worked).toBe(1);
  });

  it("counts 'wrong age' against the activity", () => {
    expect(summarizeRatings(v("wrong_age")).score).toBeLessThan(0.5);
  });
});

describe("rankActivities", () => {
  const a = (name: string, ...verdicts: string[]) => ({
    name,
    summary: summarizeRatings(v(...verdicts)),
  });

  it("puts a proven activity above one that was liked once", () => {
    const proven = a("proven", ...Array(11).fill("worked"), "flopped");
    const once = a("once", "worked");
    expect(rankActivities([once, proven]).map((x) => x.name)).toEqual(["proven", "once"]);
  });

  it("puts an untried activity above one that mostly failed, and below one that works", () => {
    const ranked = rankActivities([
      a("failed", "flopped", "flopped", "worked"),
      a("new"),
      a("works", "worked", "worked"),
    ]);
    expect(ranked.map((x) => x.name)).toEqual(["works", "new", "failed"]);
  });

  it("breaks a tie by how often it was tried, then by name", () => {
    const ranked = rankActivities([a("ב"), a("א")]);
    expect(ranked.map((x) => x.name)).toEqual(["א", "ב"]);
  });
});

describe("grades", () => {
  it("fits within the range and not outside it", () => {
    const act = { minGrade: "א'", maxGrade: "ב'" };
    expect(fitsGrade(act, "א'")).toBe(true);
    expect(fitsGrade(act, "ב'2")).toBe(true);
    expect(fitsGrade(act, "ג'")).toBe(false);
  });

  it("treats an open end as open, and a child with no grade as fitting", () => {
    expect(fitsGrade({ minGrade: "ב'" }, "ו'")).toBe(true);
    expect(fitsGrade({ minGrade: "ב'" }, "א'")).toBe(false);
    expect(fitsGrade({ minGrade: "ג'", maxGrade: "ג'" }, null)).toBe(true);
  });

  it("rejects a reversed range", () => {
    expect(gradeRangeError("ג'", "א'")).toBeTruthy();
    expect(gradeRangeError("א'", "ג'")).toBeNull();
    expect(gradeRangeError(null, "א'")).toBeNull();
  });

  it("labels a range in words", () => {
    expect(gradeRangeLabel("א'", "ג'")).toBe("כיתות א'–ג'");
    expect(gradeRangeLabel("ב'", "ב'")).toBe("כיתה ב'");
    expect(gradeRangeLabel(null, null)).toBeNull();
  });
});

describe("parseActivityInput", () => {
  it("requires a name on create", () => {
    expect(parseActivityInput({ name: "  " })).toHaveProperty("error");
  });

  it("accepts a full activity and cleans it", () => {
    const r = parseActivityInput({
      name: "  מחבואים ",
      durationMinutes: "45",
      tags: "חוץ, #אנרגיה גבוהה,חוץ",
      minGrade: "א'",
      maxGrade: "",
    });
    expect(r).toEqual({
      data: {
        name: "מחבואים",
        description: null,
        materials: null,
        tags: ["חוץ", "אנרגיה גבוהה"],
        durationMinutes: 45,
        minGrade: "א'",
        maxGrade: null,
      },
    });
  });

  it.each([0, -5, 1.5, 481, "abc"])("rejects duration %s", (d) => {
    expect(parseActivityInput({ name: "x", durationMinutes: d })).toHaveProperty("error");
  });

  it("rejects a grade it does not know", () => {
    expect(parseActivityInput({ name: "x", minGrade: "גן" })).toHaveProperty("error");
  });

  it("on a patch, touches only the fields sent", () => {
    expect(parseActivityInput({ materials: "חבל" }, { partial: true })).toEqual({
      data: { materials: "חבל" },
    });
  });
});

describe("cleanTags", () => {
  it("caps the number of tags", () => {
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(8);
  });

  it("ignores non-strings", () => {
    expect(cleanTags(["חוץ", 3, null, ""])).toEqual(["חוץ"]);
  });
});

describe("endTimeFrom", () => {
  it("adds the duration to the start", () => {
    expect(endTimeFrom("10:30", 45)).toBe("11:15");
  });
  it("gives nothing without a start or a duration, or past midnight", () => {
    expect(endTimeFrom("", 45)).toBeNull();
    expect(endTimeFrom("10:00", null)).toBeNull();
    expect(endTimeFrom("23:30", 45)).toBeNull();
  });
});

describe("rateBlockReason", () => {
  const ok = { activityId: "a1", status: "approved", date: "2026-09-29", today: "2026-09-29" };

  it("allows rating an approved bank activity on the day it ran", () => {
    expect(rateBlockReason(ok)).toBeNull();
  });
  it("allows rating it after the day", () => {
    expect(rateBlockReason({ ...ok, date: "2026-09-01" })).toBeNull();
  });
  it("refuses a day that has not come yet", () => {
    expect(rateBlockReason({ ...ok, date: "2026-09-30" })).toBeTruthy();
  });
  it("refuses a slot that was never approved — it may not have happened", () => {
    expect(rateBlockReason({ ...ok, status: "pending" })).toBeTruthy();
    expect(rateBlockReason({ ...ok, status: "draft" })).toBeTruthy();
  });
  it("refuses a slot that is not from the bank", () => {
    expect(rateBlockReason({ ...ok, activityId: null })).toBeTruthy();
  });
});

describe("the AI and the bank", () => {
  const bank = [
    {
      name: "מחבואים עם פנסים",
      durationMinutes: 40,
      tags: ["חוץ"],
      minGrade: "א'",
      maxGrade: "ג'",
      summary: summarizeRatings(v("worked", "worked")),
    },
    {
      name: "קולאז'",
      durationMinutes: null,
      tags: [],
      minGrade: null,
      maxGrade: null,
      summary: summarizeRatings([]),
    },
  ];

  it("sends the bank best-rated first, with the team's own verdicts", () => {
    const lines = bankForPrompt(bank);
    expect(lines[0]).toContain("מחבואים עם פנסים");
    expect(lines[0]).toContain("עבד 2/2");
    expect(lines[1]).toContain("עוד לא דורג");
  });

  it("tells the model to prefer the bank over inventing", () => {
    const prompt = systemPrompt([], undefined, bankForPrompt(bank));
    expect(prompt).toContain("מחבואים עם פנסים");
    expect(prompt).toContain("אל תמציא פעילות חדשה");
  });

  it("matches the model's answer to a bank entry, forgiving quotes and spaces", () => {
    expect(matchActivityByName(bank, " קולאז ")?.name).toBe("קולאז'");
    expect(matchActivityByName(bank, "משהו אחר")).toBeUndefined();
    expect(matchActivityByName(bank, "")).toBeUndefined();
  });
});

describe("grade spelling", () => {
  it("stores one spelling for a grade however it was typed", () => {
    expect(parseActivityInput({ name: "x", minGrade: "ב" })).toMatchObject({
      data: { minGrade: "ב'" },
    });
    expect(parseActivityInput({ name: "x", minGrade: "ב׳" })).toMatchObject({
      data: { minGrade: "ב'" },
    });
  });
});
