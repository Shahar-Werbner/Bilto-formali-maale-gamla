import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import { sessionCapabilities } from "@/lib/api-auth";
import { sortByGrade, STATUSES, type Status } from "@/lib/attendance";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  grade: string | null;
  present: number;
  late: number;
  absent: number;
  expected: number;
};

// Days a child was expected at: the days of every event they are listed on.
// Counting only the days that were actually marked would hide the children who
// simply stopped showing up — which is the whole point of this screen.
function attendanceRate(row: Row): number | null {
  if (row.expected === 0) return null;
  return Math.round(((row.present + row.late) / row.expected) * 100);
}

function rateColor(rate: number | null): string {
  if (rate === null) return "text-slate-400";
  if (rate >= 80) return "text-present";
  if (rate >= 50) return "text-late";
  return "text-absent";
}

export default async function ReportsPage() {
  const session = await auth();

  // The staff-hours report is a second report behind the same nav item rather
  // than a third tab: "דוחות" is one destination on a phone, and the two
  // answer different questions for different people.
  const capabilities = await sessionCapabilities();
  const canSeeHours = capabilities.includes("shift:view:own");

  const [participants, marks] = await Promise.all([
    prisma.participant.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        grade: true,
        events: {
          where: { deletedAt: null },
          select: { _count: { select: { days: true } } },
        },
      },
    }),
    prisma.eventAttendance.groupBy({
      by: ["participantId", "status"],
      // The denominator below counts days of live events only, so the marks
      // have to be scoped the same way. Counting marks from a deleted event
      // against days that no longer exist produced rates over 100%.
      where: { eventDay: { event: { deletedAt: null } } },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, Record<Status, number>>();
  for (const m of marks) {
    const row = counts.get(m.participantId) ?? {
      present: 0,
      late: 0,
      absent: 0,
    };
    if ((STATUSES as readonly string[]).includes(m.status)) {
      row[m.status as Status] = m._count._all;
    }
    counts.set(m.participantId, row);
  }

  const rows: Row[] = participants.map((p) => {
    const c = counts.get(p.id) ?? { present: 0, late: 0, absent: 0 };
    return {
      id: p.id,
      name: p.name,
      grade: p.grade,
      present: c.present,
      late: c.late,
      absent: c.absent,
      expected: p.events.reduce((sum, e) => sum + e._count.days, 0),
    };
  });

  return (
    <>
      <AppHeader
        active="/reports"
        userName={session?.user?.name}
        isAdmin={session?.user?.role === "admin"}
      />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">דוח לפי ילד/ה</h1>
          {canSeeHours && (
            <Link
              href="/reports/hours"
              className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100"
            >
              שעות צוות
            </Link>
          )}
        </div>
        <p className="mb-4 text-sm text-slate-500">
          סיכום כל האירועים. אחוז ההגעה מחושב מתוך כל ימי האירועים שהילד/ה
          רשומ/ה אליהם — כולל ימים שלא סומנו.
        </p>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
            אין עדיין ילדים במערכת.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {sortByGrade(rows).map((row, i) => {
              const rate = attendanceRate(row);
              return (
                <li
                  key={row.id}
                  className={`flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0 ${
                    i % 2 === 1 ? "bg-slate-50" : "bg-white"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">
                      {row.name}
                      {row.grade && (
                        <span className="mr-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          {row.grade}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      נוכח {row.present} · איחור {row.late} · נעדר {row.absent}
                      {row.expected > 0 && ` · מתוך ${row.expected} ימים`}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-lg font-bold ${rateColor(rate)}`}
                    dir="ltr"
                  >
                    {rate === null ? "—" : `${rate}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
