import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveEventDay } from "@/lib/event-scope";
import { safeSheetName, xlsxHeaders } from "@/lib/xlsx";
import { formatTimeRange } from "@/lib/events";
import {
  DISMISSAL_STATE_LABEL,
  dismissalState,
  type DismissalMethod,
} from "@/lib/dismissal";
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

// GET /api/event-days/:id/export — one session as a colored .xlsx.
//
// The sheet carries what the day's screens know, not only attendance. Three
// separate field notes in the roadmap said the same thing about this file:
// the session's hours, the group split and — most of all — **who took each
// child home** all existed in the database and in no export. The dismissal is
// the one somebody goes looking for after an incident, which is exactly when
// "it is on a screen somewhere" is not an answer.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("event:view");
  if (response) return response;

  try {
    const day = await prisma.eventDay.findFirst({
      where: liveEventDay(params.id),
      include: {
        event: { include: { participants: { where: { deletedAt: null } } } },
        attendance: { select: { participantId: true, status: true } },
        // Who went home with whom. `markedBy` is included because "who signed
        // this child out" is the first question after something goes wrong,
        // and until now it was stored and shown nowhere at all.
        dismissals: {
          select: {
            participantId: true,
            method: true,
            pickedUpByName: true,
            note: true,
            at: true,
            markedBy: { select: { name: true } },
          },
        },
        // Which group each child was in on this day (item 3) — per-session, so
        // it belongs on the day's sheet rather than on the roster's.
        groupAssignments: {
          select: { participantId: true, group: { select: { name: true } } },
        },
      },
    });
    if (!day) {
      return NextResponse.json({ error: "יום לא נמצא" }, { status: 404 });
    }

    const statusByParticipant: Record<string, Status> = {};
    for (const rec of day.attendance) {
      statusByParticipant[rec.participantId] = rec.status as Status;
    }
    const dismissalByParticipant = new Map(
      day.dismissals.map((d) => [d.participantId, d]),
    );
    const groupByParticipant = new Map(
      day.groupAssignments.map((a) => [a.participantId, a.group.name]),
    );
    const dateStr = formatDateOnly(day.date);
    const hours = formatTimeRange(day.startTime, day.endTime);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(safeSheetName(dateStr, "יום"), {
      views: [{ rightToLeft: true }],
    });

    // Title rows.
    ws.mergeCells("A1:C1");
    ws.getCell("A1").value = `${day.event.name} — ${hebDate(dateStr)}`;
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.getCell("A1").alignment = { horizontal: "right" };

    // The session's hours. Whoever receives this file was reading attendance
    // with no idea how long the session ran, which is also the span the staff
    // hours for the day are derived from.
    const subtitle: string[] = [];
    if (hours) subtitle.push(`שעות המפגש ${hours}`);
    if (day.description) subtitle.push(`פעילות: ${day.description}`);
    if (subtitle.length > 0) {
      ws.mergeCells("A2:C2");
      ws.getCell("A2").value = subtitle.join(" · ");
      ws.getCell("A2").alignment = { horizontal: "right" };
    }

    // Table header.
    const headerRowNum = subtitle.length > 0 ? 4 : 3;
    ws.columns = [
      { key: "name", width: 24 },
      { key: "grade", width: 8 },
      { key: "group", width: 14 },
      { key: "status", width: 12 },
      { key: "dismissal", width: 14 },
      { key: "pickedUpBy", width: 18 },
      { key: "dismissalAt", width: 10 },
      { key: "markedBy", width: 16 },
      { key: "dismissalNote", width: 24 },
    ];
    const header = ws.getRow(headerRowNum);
    header.values = [
      "שם",
      "כיתה",
      "קבוצה",
      "נוכחות",
      "שחרור",
      "נאסף/ה על ידי",
      "שעת שחרור",
      "מי שחרר/ה",
      "הערת שחרור",
    ];
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
    let waiting = 0;
    for (const p of sortByGrade(day.event.participants)) {
      const st = statusByParticipant[p.id];
      const dismissal = dismissalByParticipant.get(p.id);
      const state = dismissalState(
        dismissal
          ? {
              method: dismissal.method as DismissalMethod,
              pickedUpByName: dismissal.pickedUpByName,
            }
          : null,
      );
      // Only a child who was actually here can be waiting to go home. An
      // absent child with no dismissal row is not an open end of the day.
      const here = st === "present" || st === "late";
      if (here && state === "waiting") waiting++;

      const row = ws.addRow({
        name: p.name,
        grade: p.grade ?? "",
        group: groupByParticipant.get(p.id) ?? "",
        status: st ? STATUS_LABEL[st] : "",
        // A child who was not here has no end of day to report, so the cell
        // stays empty rather than claiming they are "waiting".
        dismissal: here || dismissal ? DISMISSAL_STATE_LABEL[state] : "",
        pickedUpBy: dismissal?.pickedUpByName ?? "",
        dismissalAt: dismissal?.at ? timeOfDay(dismissal.at) : "",
        markedBy: dismissal?.markedBy?.name ?? "",
        dismissalNote: dismissal?.note ?? "",
      });
      row.getCell("name").alignment = { horizontal: "right" };
      for (const key of ["grade", "status", "dismissal", "dismissalAt"]) {
        row.getCell(key).alignment = { horizontal: "center" };
      }
      const statusCell = row.getCell("status");
      if (st) {
        counts[st]++;
        statusCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: FILL[st] },
        };
        statusCell.font = { color: { argb: FONT[st] } };
      }
      // A child who was here and has no dismissal row is the one line in this
      // sheet that means an open question, so it is coloured like one.
      if (here && state === "waiting") {
        row.getCell("dismissal").fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFEB9C" },
        };
        row.getCell("dismissal").font = { color: { argb: "FF9C6500" } };
      }
    }

    // Summary rows.
    ws.addRow([]);
    const summary = ws.addRow([
      `סה"כ: נוכחים ${counts.present} · איחורים ${counts.late} · נעדרים ${counts.absent}`,
    ]);
    summary.font = { bold: true };
    if (waiting > 0) {
      const open = ws.addRow([
        waiting === 1
          ? "ילד/ה אחד/ת נכח/ה ולא נרשם/ה שחרור"
          : `${waiting} ילדים נכחו ולא נרשם להם שחרור`,
      ]);
      open.font = { bold: true, color: { argb: "FF9C6500" } };
    }

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

// `Dismissal.at` is a real timestamp (the moment it was marked), unlike the
// calendar-day columns — so it is rendered in Asia/Jerusalem rather than UTC,
// or a 16:30 pickup reads as 13:30 in the file.
function timeOfDay(at: Date): string {
  return at.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
}
