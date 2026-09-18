import { describe, expect, it } from "vitest";
import { safeSheetName, xlsxHeaders } from "../xlsx";

describe("safeSheetName", () => {
  it("strips the characters Excel rejects in a sheet name", () => {
    expect(safeSheetName("קייטנה א/ב", "אירוע")).toBe("קייטנה א ב");
    expect(safeSheetName("סיכום: 2026 [טיוטה]", "אירוע")).toBe(
      "סיכום  2026  טיוטה",
    );
  });

  it("caps the length at 31 characters", () => {
    expect(safeSheetName("א".repeat(50), "אירוע")).toHaveLength(31);
  });

  it("falls back when nothing usable is left", () => {
    expect(safeSheetName("///", "אירוע")).toBe("אירוע");
    expect(safeSheetName("   ", "אירוע")).toBe("אירוע");
  });
});

describe("xlsxHeaders", () => {
  it("percent-encodes a Hebrew filename", () => {
    const headers = xlsxHeaders("נוכחות.xlsx");
    expect(headers["Content-Disposition"]).toContain("filename*=UTF-8''");
    expect(headers["Content-Disposition"]).toContain(
      encodeURIComponent("נוכחות.xlsx"),
    );
  });
});
