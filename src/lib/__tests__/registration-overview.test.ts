import { describe, expect, it } from "vitest";
import {
  dayEquipment,
  foodCount,
  foodCountFromGroups,
  hidePhones,
  notYetRegistered,
  previousEvent,
  previousParticipants,
  whatsappNameList,
} from "../registration-overview";

describe("food per day", () => {
  it("counts only children coming, and keeps 'not said' apart", () => {
    expect(
      foodCount([
        { coming: true, bringsFood: true },
        { coming: true, bringsFood: false },
        { coming: true, bringsFood: false },
        { coming: true, bringsFood: null },
        // Not coming: whatever was said about food does not feed anyone.
        { coming: false, bringsFood: false },
        { coming: false, bringsFood: null },
      ]),
    ).toEqual({ coming: 4, withFood: 1, withoutFood: 2, unknown: 1 });
  });

  it("gives the same numbers from database groups as from rows", () => {
    expect(
      foodCountFromGroups([
        { coming: true, bringsFood: true, count: 3 },
        { coming: true, bringsFood: false, count: 5 },
        { coming: true, bringsFood: null, count: 1 },
        { coming: false, bringsFood: null, count: 7 },
      ]),
    ).toEqual({ coming: 9, withFood: 3, withoutFood: 5, unknown: 1 });
  });

  it("is all zero with no answers", () => {
    expect(foodCount([])).toEqual({ coming: 0, withFood: 0, withoutFood: 0, unknown: 0 });
  });
});

describe("היום צריך", () => {
  it("is the event's list, then the day's additions", () => {
    expect(dayEquipment(["מים", "כובע"], ["בגד ים", "מגבת"])).toEqual([
      "מים",
      "כובע",
      "בגד ים",
      "מגבת",
    ]);
  });

  it("does not repeat an item on both lists, even typed slightly differently", () => {
    expect(dayEquipment(["כובע", "מים"], ["כובע ", "מים"])).toEqual(["כובע", "מים"]);
  });

  it("is empty when nothing was set — no default list", () => {
    expect(dayEquipment([], [])).toEqual([]);
  });
});

describe("the previous event", () => {
  const current = { id: "now", startDate: "2026-12-20", endDate: "2026-12-24" };

  it("is the latest one that started before this one, by date not by creation", () => {
    const events = [
      { id: "summer", startDate: "2026-07-01", endDate: "2026-07-10" },
      { id: "sukkot", startDate: "2026-10-05", endDate: "2026-10-08" },
      { id: "later", startDate: "2027-04-01", endDate: "2027-04-05" },
    ];
    expect(previousEvent(events, current)?.id).toBe("sukkot");
  });

  it("is never this event, nor one starting the same day", () => {
    const events = [
      { ...current },
      { id: "same-day", startDate: "2026-12-20", endDate: "2026-12-21" },
    ];
    expect(previousEvent(events, current)).toBeNull();
  });

  it("breaks a tie on start date by the later end", () => {
    const events = [
      { id: "short", startDate: "2026-10-01", endDate: "2026-10-01" },
      { id: "long", startDate: "2026-10-01", endDate: "2026-10-05" },
    ];
    expect(previousEvent(events, current)?.id).toBe("long");
  });
});

describe("who took part in the previous event", () => {
  it("is who was marked present or late there", () => {
    expect(previousParticipants(["a", "b", "a"], ["a", "b", "c"])).toEqual({
      ids: ["a", "b"],
      basis: "attended",
    });
  });

  it("falls back to who was on it when nobody was ever marked", () => {
    expect(previousParticipants([], ["a", "b", "c"])).toEqual({
      ids: ["a", "b", "c"],
      basis: "rostered",
    });
  });
});

describe("who has not registered yet", () => {
  const kids = [
    { id: "1", name: "תמר", grade: "ג" },
    { id: "2", name: "נועם", grade: "א" },
    { id: "3", name: "אורי", grade: "ב" },
    { id: "4", name: "יעל", grade: "א" },
  ];

  it("leaves out every child the form has heard about, sorted by grade", () => {
    // 1 registered, 3 is on the waiting list or answered "not coming" — any
    // answer takes the family off the reminder.
    expect(notYetRegistered(kids, new Set(["1", "3"])).map((k) => k.name)).toEqual([
      "יעל",
      "נועם",
    ]);
  });

  it("is everyone when nobody has answered", () => {
    expect(notYetRegistered(kids, new Set()).map((k) => k.id)).toEqual(["4", "2", "3", "1"]);
  });
});

describe("the WhatsApp list", () => {
  it("is a title and names, one per line — nothing else", () => {
    expect(whatsappNameList("עוד לא נרשמו לקייטנה:", ["נועם", "יעל"])).toBe(
      "עוד לא נרשמו לקייטנה:\n• נועם\n• יעל",
    );
  });
});

describe("a phone number in a parent's note", () => {
  it.each([
    ["אם יש בעיה תתקשרו לסבתא 052-1234567", "אם יש בעיה תתקשרו לסבתא [טלפון מוסתר]"],
    ["אבא: 0521234567", "אבא: [טלפון מוסתר]"],
    ["+972 52 123 4567 בבקשה", "[טלפון מוסתר] בבקשה"],
    ["בבית 02-6123456", "בבית [טלפון מוסתר]"],
  ])("is hidden: %s", (input, out) => {
    expect(hidePhones(input)).toBe(out);
  });

  it("leaves the rest of the note, and ordinary numbers, alone", () => {
    expect(hidePhones("יוצאת ב-11:30, מגיעה עם 2 חברות")).toBe(
      "יוצאת ב-11:30, מגיעה עם 2 חברות",
    );
  });
});
