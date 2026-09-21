import { NextResponse } from "next/server";
import { requireCapability, sessionCan } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { ROLE_LABEL, isRole } from "@/lib/roles";
import { loadMonthHours } from "@/lib/hours-query";
import {
  currentMonth,
  isMonth,
  monthLabel,
  summarizeMonth,
  totalHours,
} from "@/lib/hours";

// GET /api/reports/hours?month=YYYY-MM — a month of staff hours.
//
// The hours are derived, never stored: a shift with no times of its own is
// worth the session's hours (item 1), and only an exception — came late, left
// after tidying up — is typed in on the day's screen. That is why this route
// only reads.
//
// The soft-delete filter lives in loadMonthHours() (@/lib/hours-query), which
// the .xlsx export calls as well, so the file and this screen cannot disagree
// about who worked when.
export async function GET(request: Request) {
  const { session, response } = await requireCapability("shift:view:own");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get("month");
    // An absent month means "this month"; a malformed one is named rather than
    // quietly replaced, because answering for a different month than the one
    // asked for is how a wrong number reaches a payroll sheet.
    if (requested !== null && !isMonth(requested)) {
      return NextResponse.json(
        { error: "חודש לא תקין (פורמט YYYY-MM)" },
        { status: 400 },
      );
    }
    const month = requested ?? currentMonth();

    // Scope follows the capability, not what the screen chooses to render —
    // the same rule as /api/shifts. Without `shift:view:all` the answer holds
    // the caller's own month and nobody else's: most of the team are
    // 15-year-olds on their own phones, and what everyone else worked is not
    // theirs to read off it. Data that is not sent cannot leak.
    const canViewAll = await sessionCan("shift:view:all");

    const rows = await loadMonthHours({
      month,
      userId: canViewAll ? null : session.user.id,
    });

    const people = summarizeMonth(rows).map((p) => ({
      ...p,
      roleLabel: isRole(p.userRole) ? ROLE_LABEL[p.userRole] : p.userRole,
    }));

    return NextResponse.json({
      month,
      monthLabel: monthLabel(month),
      people,
      totalHours: totalHours(people),
      canViewAll,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
