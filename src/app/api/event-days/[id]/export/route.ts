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

function hebDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

// GET /api/event-days/:id/export — attendance for a single day as a colored .xlsx.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const day = await prisma.eventDay.findUnique({
      where: { id: params.id },
      include: {
        event: { include: { participants: { where: { deletedAt: null } } } },
        attendance: { select: { participantId: true, status: true } },
      },
    });
    if (!day) {
      return NextResponse.json({ error: "יום לא נמצא" }, { status: 404 });
    }

    const statusByParticipant: Record<string, Status> = {};
    for (const rec of day.attendance) {
      statusByParticipant[rec.participantId] = rec.status as Status;
    }
    const dateStr = formatDateOnly(day.date);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(safeSheetName(dateStr, "יום"), {
      views: [{ rightToLeft: true }],
    });

    // Title rows.
    ws.mergeCells("A1:C1");
    ws.getCell("A1").value = `${day.event.name} — ${hebDate(dateStr)}`;
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.getCell("A1").alignment = { horizontal: "right" };
    if (day.description) {
      ws.mergeCells("A2:C2");
      ws.getCell("A2").value = `פעילות: ${day.description}`;
      ws.getCell("A2").alignment = { horizontal: "right" };
    }

    // Table header.
    const headerRowNum = day.description ? 4 : 3;
    ws.columns = [
      { key: "name", width: 24 },
      { key: "grade", width: 10 },
      { key: "status", width: 14 },
    ];
    const header = ws.getRow(headerRowNum);
    header.values = ["שם", "כיתה", "נוכחות"];
    header.font = { bold: true };
    header.alignment = { horizontal: "center" };
    header.getCell(1).alignment = { horizontal: "right" };
    header.eachCell((c) => {
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFEFEF" },
      };
    });

    const counts = { present: 0, late: 0, absent: 0 };
    for (const p of sortByGrade(day.event.participants)) {
      const st = statusByParticipant[p.id];
      const row = ws.addRow({
        name: p.name,
        grade: p.grade ?? "",
        status: st ? STATUS_LABEL[st] : "",
      });
      row.getCell("name").alignment = { horizontal: "right" };
      row.getCell("grade").alignment = { horizontal: "center" };
      const statusCell = row.getCell("status");
      statusCell.alignment = { horizontal: "center" };
      if (st) {
        counts[st]++;
        statusCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: FILL[st] },
        };
        statusCell.font = { color: { argb: FONT[st] } };
      }
    }

    // Summary row.
    ws.addRow([]);
    const summary = ws.addRow([
      `סה"כ: נוכחים ${counts.present} · איחורים ${counts.late} · נעדרים ${counts.absent}`,
    ]);
    summary.font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `attendance-${day.event.name}-${dateStr}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: xlsxHeaders(filename),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
