// The one query behind the monthly hours report, shared by the screen's JSON
// route and the .xlsx export.
//
// Why it is not written twice: the recurring complaint in the roadmap's field
// notes is a number that exists on a screen and not in the file somebody sends
// on (the dismissal, the groups, the session hours — three separate notes).
// Hours are the worst case of that, because the file is the one people act on.
// One loader means the sheet cannot disagree with the screen about who worked
// when, however either of them is edited later.
//
// It also holds the soft-delete filter for both (invariant 1). The sweep in
// event-scope.test.ts reads route sources, so it does not see this file —
// hours.test.ts asserts the filter is here instead.

import { prisma } from "@/lib/prisma";
import { LIVE_EVENT } from "@/lib/event-scope";
import { formatDateOnly, parseDateOnly } from "@/lib/attendance";
import { monthRange, type HoursRow } from "@/lib/hours";

export type MonthHoursScope = {
  /** The month to sum, "YYYY-MM". Already validated by the caller. */
  month: string;
  /**
   * null loads the whole team; a user id loads that person alone.
   *
   * This is the `shift:view:all` decision, and it is taken here rather than in
   * the route so the file and the screen cannot end up applying it differently.
   */
  userId: string | null;
};

/** Every shift in the month, flattened into what summarizeMonth() sums. */
export async function loadMonthHours({
  month,
  userId,
}: MonthHoursScope): Promise<HoursRow[]> {
  const range = monthRange(month);
  if (!range) return [];

  const shifts = await prisma.shift.findMany({
    where: {
      eventDay: {
        // Invariant 1: a soft-deleted event is gone from every report too. Its
        // days are still in the database, and counting them would pay people
        // for sessions the rest of the system says never happened.
        event: LIVE_EVENT,
        date: {
          gte: parseDateOnly(range.start)!,
          lte: parseDateOnly(range.end)!,
        },
      },
      ...(userId ? { userId } : {}),
    },
    select: {
      userId: true,
      startTime: true,
      endTime: true,
      role: true,
      note: true,
      user: { select: { name: true, role: true } },
      eventDay: {
        select: {
          date: true,
          startTime: true,
          endTime: true,
          event: { select: { name: true } },
        },
      },
    },
  });

  return shifts.map((s) => ({
    userId: s.userId,
    userName: s.user.name,
    userRole: s.user.role,
    date: formatDateOnly(s.eventDay.date),
    eventName: s.eventDay.event.name,
    dayStartTime: s.eventDay.startTime,
    dayEndTime: s.eventDay.endTime,
    startTime: s.startTime,
    endTime: s.endTime,
    role: s.role,
    note: s.note,
  }));
}
