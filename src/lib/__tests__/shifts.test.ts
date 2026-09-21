import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CHILDREN_PER_STAFF,
  effectiveHours,
  parseShiftInput,
  staffing,
  staffingAlert,
  staffingLabel,
} from "../shifts";

describe("effectiveHours", () => {
  const day = { startTime: "16:00", endTime: "19:00" };

  it("takes the session's hours when the shift says nothing", () => {
    // The spec's first test: default hours come from the session. Storing the
    // day's times on every shift row instead would leave them stale the moment
    // the session's hours are corrected.
    expect(effectiveHours({ startTime: null, endTime: null }, day)).toEqual({
      startTime: "16:00",
      endTime: "19:00",
      hours: 3,
      overridden: false,
    });
  });

  it("lets a manual override win", () => {
    expect(effectiveHours({ startTime: "17:00", endTime: "19:00" }, day)).toEqual({
      startTime: "17:00",
      endTime: "19:00",
      hours: 2,
      overridden: true,
    });
  });

  it("overrides one end without making anyone retype the other", () => {
    // "Came an hour late" is one field. Requiring both would be a pair someone
    // mistypes at the end of a long day.
    expect(effectiveHours({ startTime: "17:00", endTime: null }, day)).toEqual({
      startTime: "17:00",
      endTime: "19:00",
      hours: 2,
      overridden: true,
    });
  });

  it("answers zero hours for a day with no hours at all", () => {
    const none = { startTime: null, endTime: null };
    expect(effectiveHours(none, none)).toEqual({
      startTime: null,
      endTime: null,
      hours: 0,
      overridden: false,
    });
  });

  it("answers zero hours for an inverted pair rather than a negative month", () => {
    expect(effectiveHours({ startTime: "20:00", endTime: "16:00" }, day).hours).toBe(0);
  });
});

describe("parseShiftInput", () => {
  it("reads an empty string as 'the session's hours'", () => {
    // That is what a cleared <input type="time"> sends.
    const parsed = parseShiftInput({ startTime: "", endTime: "" });
    expect(parsed).toEqual({
      ok: true,
      value: { startTime: null, endTime: null, role: null, note: null },
    });
  });

  it("keeps a valid pair, with the role and note trimmed", () => {
    const parsed = parseShiftInput({
      startTime: "16:30",
      endTime: "19:00",
      role: "  אחראי  ",
      note: "  ",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        startTime: "16:30",
        endTime: "19:00",
        role: "אחראי",
        note: null,
      },
    });
  });

  it("refuses a malformed time", () => {
    expect(parseShiftInput({ startTime: "16:70" }).ok).toBe(false);
    expect(parseShiftInput({ startTime: "4pm" }).ok).toBe(false);
  });

  it("refuses an inverted pair", () => {
    const parsed = parseShiftInput({ startTime: "19:00", endTime: "16:00" });
    expect(parsed.ok).toBe(false);
  });
});

describe("staffing", () => {
  const base = {
    rosteredChildren: 40,
    markedChildren: null,
    staffCount: 5,
    adultCount: 2,
    maxChildrenPerStaff: null,
  };

  it("falls back to the app-wide threshold when the event sets none", () => {
    expect(staffing(base).threshold).toBe(DEFAULT_MAX_CHILDREN_PER_STAFF);
  });

  it("uses the event's threshold when it has one", () => {
    // A craft afternoon and a trip are not the same question, which is why the
    // column is per event.
    expect(staffing({ ...base, maxChildrenPerStaff: 10 }).threshold).toBe(10);
  });

  it("is content when the ratio is met", () => {
    const s = staffing(base); // 40 children, 5 counselors, threshold 8
    expect(s.level).toBe("ok");
    expect(s.missingStaff).toBe(0);
    expect(s.perStaff).toBe(8);
  });

  it("says how many counselors are missing, not only that some are", () => {
    // "Short-staffed" is not actionable at 07:00 on a Tuesday; "two more" is.
    const s = staffing({ ...base, staffCount: 3 });
    expect(s.level).toBe("short");
    expect(s.missingStaff).toBe(2);
    expect(s.perStaff).toBe(13.3);
  });

  it("treats nobody assigned as its own state, not as 'short by five'", () => {
    const s = staffing({ ...base, staffCount: 0, adultCount: 0 });
    expect(s.level).toBe("none");
    expect(s.perStaff).toBe(0);
  });

  it("stays quiet about a day with no children", () => {
    const s = staffing({ ...base, rosteredChildren: 0, staffCount: 0, adultCount: 0 });
    expect(s.level).toBe("ok");
    expect(s.noAdult).toBe(false);
  });

  it("counts the roster while the day is only partly marked", () => {
    // The dangerous shape: five children marked of forty, halfway through the
    // morning, must not read as "five children, plenty of staff".
    const s = staffing({ ...base, markedChildren: null, staffCount: 1 });
    expect(s.children).toBe(40);
    expect(s.childrenSource).toBe("roster");
    expect(s.level).toBe("short");
  });

  it("uses the real number once the day is fully marked", () => {
    const s = staffing({ ...base, markedChildren: 24, staffCount: 3 });
    expect(s.children).toBe(24);
    expect(s.childrenSource).toBe("marked");
    expect(s.level).toBe("ok");
  });

  it("flags a session with counselors but no adult", () => {
    // Most of the team are teenagers here, so "four counselors" can mean four
    // 15-year-olds — a different sentence from "short-staffed".
    const s = staffing({ ...base, staffCount: 5, adultCount: 0 });
    expect(s.noAdult).toBe(true);
    expect(s.level).toBe("ok"); // the ratio itself is fine
  });

  it("does not flag a missing adult when nobody is assigned at all", () => {
    // That day already has a louder message.
    expect(staffing({ ...base, staffCount: 0, adultCount: 0 }).noAdult).toBe(false);
  });

  it("ignores a zero or negative threshold rather than dividing by it", () => {
    for (const bad of [0, -5]) {
      expect(staffing({ ...base, maxChildrenPerStaff: bad }).threshold).toBe(
        DEFAULT_MAX_CHILDREN_PER_STAFF,
      );
    }
  });
});

const day = (over: Partial<Parameters<typeof staffing>[0]> = {}) =>
  staffing({
    rosteredChildren: 38,
    markedChildren: null,
    staffCount: 4,
    adultCount: 1,
    maxChildrenPerStaff: null,
    ...over,
  });

describe("staffingLabel", () => {
  it("names the day in the terms the question is asked in", () => {
    // No "1:9.5": a colon ratio comes out reversed inside an RTL line, which
    // is the only place this is ever read.
    expect(staffingLabel(day())).toBe("38 ילדים · 4 מדריכים · 9.5 למדריך/ה");
  });

  it("says plainly when nobody is on the session", () => {
    expect(staffingLabel(day({ staffCount: 0, adultCount: 0 }))).toContain(
      "אף אחד לא משובץ",
    );
  });
});

describe("staffingAlert", () => {
  it("stays silent when the day is staffed", () => {
    expect(staffingAlert(day({ maxChildrenPerStaff: 10 }))).toBeNull();
  });

  it("counts in people, because that is what somebody can act on", () => {
    const text = staffingAlert(day({ staffCount: 2, maxChildrenPerStaff: 10 }));
    expect(text).toContain("חסרים 2 מדריכים");
  });

  it("gets Hebrew agreement right for one", () => {
    // "חסרים 1 מדריכים" is the kind of wrong that makes an app feel like it
    // was not written for the people reading it — who are teenagers.
    const text = staffingAlert(day({ staffCount: 3, maxChildrenPerStaff: 10 }));
    expect(text).toContain("חסר/ה מדריך/ה אחד/ת");
    expect(text).not.toMatch(/חסרים 1/);
  });

  it("says what the threshold is, so the number is arguable", () => {
    expect(staffingAlert(day({ staffCount: 1 }))).toContain("8 ילדים למדריך/ה");
  });

  it("has its own sentence for a day nobody is on", () => {
    expect(staffingAlert(day({ staffCount: 0, adultCount: 0 }))).toContain(
      "אף מדריך/ה לא משובץ/ת",
    );
  });
});
