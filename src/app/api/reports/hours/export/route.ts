import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireCapability, sessionCan } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { safeSheetName, xlsxHeaders } from "@/lib/xlsx";
import { ROLE_LABEL, isRole } from "@/lib/roles";
import { loadMonthHours } from "@/lib/hours-query";
import {
  currentMonth,
  isMonth,
  monthLabel,
  summarizeMonth,
  totalHours,
} from "@/lib/hours";
import { formatHebrewDate } from "@/lib/events";

// GET /api/reports/hours/export?month=YYYY-MM — the month as a two-sheet .xlsx.
//
// Two sheets rather than one, because two different people read this file. A
// summary of "who worked how much" is what goes to whoever pays; the per-day
// detail is what someone checks a disputed number against, and it has to carry
// the session each row came from or there is nothing to check against.
//
// Hours only — no rates and no sums of money. That is the owner's decision from
// 19.09 and it is worth restating where the file is written: most of the team
// are minors, youth employment is regulated, and a rate table is a new class of
// data that should not arrive as a side effect of an export.
//
// Scope is the same as the screen's (see the JSON route): without
// `shift:view:all` the file holds the caller's own month, which is exactly what
// a youth counselor needs in order to send in their own hours.
export async function GET(request: Request) {
  const { session, response } = await requireCapability("shift:view:own");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get("month");
    if (requested !== null && !isMonth(requested)) {
      return NextResponse.json(
        { error: "חודש לא תקין (פורמט YYYY-MM)" },
        { status: 400 },
      );
    }
    const month = requested ?? currentMonth();
    const canViewAll = await sessionCan("shift:view:all");

    const rows = await loadMonthHours({
      month,
      userId: canViewAll ? null : session.user.id,
    });
    const people = summarizeMonth(rows);
    const label = monthLabel(month);

    const wb = new ExcelJS.Workbook();

    // ── Sheet 1: one line per person ────────────────────────────────────────
    const summary = wb.addWorksheet(safeSheetName(`סיכום ${month}`, "סיכום"), {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 2 }],
    });
    summary.mergeCells("A1:D1");
    summary.getCell("A1").value = `שעות צוות — ${label}`;
    summary.getCell("A1").font = { bold: true, size: 14 };
    summary.getCell("A1").alignment = { horizontal: "right" };

    summary.columns = [
      { key: "name", width: 24 },
      { key: "role", width: 18 },
      { key: "hours", width: 12 },
      { key: "days", width: 12 },
      { key: "missing", width: 22 },
    ];
    const summaryHeader = summary.getRow(2);
    summaryHeader.values = [
      "שם",
      "תפקיד",
      'סה"כ שעות',
      "מפגשים",
      "מפגשים בלי שעות",
    ];
    styleHeader(summaryHeader);

    for (const person of people) {
      const row = summary.addRow({
        name: person.name,
        role: isRole(person.userRole)
          ? ROLE_LABEL[person.userRole]
          : person.userRole,
        // Written as a number, not a string: this column gets summed and
        // sorted by whoever receives it, and text that looks like a number is
        // the classic way a spreadsheet silently refuses to add up.
        hours: person.totalHours,
        days: person.dayCount,
        missing: person.missingHoursDays || "",
      });
      row.getCell("name").alignment = { horizontal: "right" };
      row.getCell("hours").numFmt = "0.00";
      // A session worth nothing is the one thing in this file somebody has to
      // go and fix, so it is coloured rather than left as a quiet number.
      if (person.missingHoursDays > 0) {
        row.getCell("missing").fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFEB9C" },
        };
        row.getCell("missing").font = { color: { argb: "FF9C6500" } };
      }
    }

    summary.addRow([]);
    const total = summary.addRow({
      name: 'סה"כ',
      hours: totalHours(people),
    });
    total.font = { bold: true };
    total.getCell("name").alignment = { horizontal: "right" };
    total.getCell("hours").numFmt = "0.00";

    // ── Sheet 2: one line per person per session ────────────────────────────
    const detail = wb.addWorksheet(safeSheetName(`פירוט ${month}`, "פירוט"), {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    });
    detail.columns = [
      { header: "שם", key: "name", width: 20 },
      { header: "תאריך", key: "date", width: 16 },
      { header: "אירוע", key: "event", width: 22 },
      { header: "משעה", key: "start", width: 9 },
      { header: "עד שעה", key: "end", width: 9 },
      { header: "שעות", key: "hours", width: 9 },
      { header: "מקור השעות", key: "source", width: 14 },
      { header: "תפקיד ביום", key: "dayRole", width: 18 },
      { header: "הערה", key: "note", width: 28 },
    ];
    styleHeader(detail.getRow(1));

    for (const person of people) {
      for (const day of person.days) {
        const row = detail.addRow({
          name: person.name,
          date: formatHebrewDate(day.date),
          event: day.eventName,
          start: day.startTime ?? "",
          end: day.endTime ?? "",
          hours: day.hours,
          // The column that makes a disputed number checkable: whether this
          // row is the session's own hours or an exception somebody typed —
          // and, for a row worth nothing, which of the two is missing. "שעות
          // המפגש" next to an empty range and a zero explains nothing to the
          // person who has to go and fix it.
          source: hoursSource(day),
          dayRole: day.role ?? "",
          note: day.note ?? "",
        });
        row.getCell("name").alignment = { horizontal: "right" };
        row.getCell("hours").numFmt = "0.00";
        for (const key of ["date", "start", "end", "hours", "source"]) {
          row.getCell(key).alignment = { horizontal: "center" };
        }
        if (day.hours === 0) {
          row.getCell("hours").fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFEB9C" },
          };
        }
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: xlsxHeaders(`staff-hours-${month}.xlsx`),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// Why a row is worth what it is worth. A zero is never left to be read as a
// fact about somebody's month: it is either a session whose hours were never
// set, or a typed pair that does not make sense, and those are fixed in two
// different places.
function hoursSource(day: { hours: number; overridden: boolean }): string {
  if (day.hours === 0) {
    return day.overridden ? "שעות לא תקינות" : "לא הוגדרו שעות";
  }
  return day.overridden ? "חריג ידני" : "שעות המפגש";
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.alignment = { horizontal: "center", vertical: "middle" };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFEFEF" },
    };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
  });
}
