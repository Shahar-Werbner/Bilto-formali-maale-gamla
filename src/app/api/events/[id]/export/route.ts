import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { safeSheetName, xlsxHeaders } from "@/lib/xlsx";
import {
  formatDateOnly,
  sortByGrade,
  STATUS_LABEL,
  type Status,
} from "@/lib/attendance";

// Cell fills per status (classic spreadsheet green/yellow/red, preserved when
// the .xlsx is opened in Google Sheets).
const FILL: Record<Status, string> = {
  present: "FFC6EFCE",
  late: "FFFFEB9C",
  absent: "FFFFC7CE",
};
const FONT: Record<Status, string> = {
  present: "FF006100",
  late: "FF9C6500",
  absent: "FF9C0006",
};

function shortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
    timeZone: "UTC",
  });
}

// GET /api/events/:id/export — attendance grid as a colored .xlsx.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const event = await prisma.event.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        participants: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
        },
        days: {
          orderBy: { date: "asc" },
          include: {
            attendance: { select: { participantId: true, status: true } },
          },
        },
      },
    });
    if (!event) {
      return NextResponse.json({ error: "אירוע לא נמצא" }, { status: 404 });
    }

    // status[participantId][dayId]
    const status: Record<string, Record<string, Status>> = {};
    for (const day of event.days) {
      for (const rec of day.attendance) {
        (status[rec.participantId] ??= {})[day.id] = rec.status as Status;
      }
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(safeSheetName(event.name, "אירוע"), {
      views: [{ rightToLeft: true, state: "frozen", xSplit: 2, ySplit: 1 }],
    });

    // Columns: name, grade, one per day, then 3 summary columns.
    ws.columns = [
      { header: "שם", key: "name", width: 22 },
      { header: "כיתה", key: "grade", width: 8 },
      ...event.days.map((d) => ({
        header: shortDate(formatDateOnly(d.date)),
        key: d.id,
        width: 11,
      })),
      { header: "נוכח", key: "sum_present", width: 7 },
      { header: "איחור", key: "sum_late", width: 7 },
      { header: "נעדר", key: "sum_absent", width: 7 },
    ];

    // Header styling.
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { horizontal: "center", vertical: "middle" };
    header.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFEFEF" },
      };
      cell.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
    });

    for (const p of sortByGrade(event.participants)) {
      const counts = { present: 0, late: 0, absent: 0 };
      const row: Record<string, string> = {
        name: p.name,
        grade: p.grade ?? "",
      };
      for (const d of event.days) {
        const st = status[p.id]?.[d.id];
        if (st) {
          row[d.id] = STATUS_LABEL[st];
          counts[st]++;
        }
      }
      row.sum_present = String(counts.present);
      row.sum_late = String(counts.late);
      row.sum_absent = String(counts.absent);

      const added = ws.addRow(row);
      added.alignment = { horizontal: "center" };
      added.getCell("name").alignment = { horizontal: "right" };

      // Color the day cells by status.
      for (const d of event.days) {
        const st = status[p.id]?.[d.id];
        if (!st) continue;
        const cell = added.getCell(d.id);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: FILL[st] },
        };
        cell.font = { color: { argb: FONT[st] } };
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `attendance-${event.name}-${formatDateOnly(event.startDate)}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: xlsxHeaders(filename),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
