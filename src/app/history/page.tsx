import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import { formatDateOnly, type Status } from "@/lib/attendance";

export const dynamic = "force-dynamic";

type DaySummary = {
  date: string;
  present: number;
  late: number;
  absent: number;
  total: number;
};

export default async function HistoryPage() {
  const session = await auth();

  const rows = await prisma.attendanceRecord.groupBy({
    by: ["date", "status"],
    _count: { _all: true },
    orderBy: { date: "desc" },
  });

  const byDate = new Map<string, DaySummary>();
  for (const row of rows) {
    const key = formatDateOnly(row.date);
    const entry =
      byDate.get(key) ??
      { date: key, present: 0, late: 0, absent: 0, total: 0 };
    const count = row._count._all;
    if (row.status === ("present" satisfies Status)) entry.present += count;
    else if (row.status === ("late" satisfies Status)) entry.late += count;
    else if (row.status === ("absent" satisfies Status)) entry.absent += count;
    entry.total += count;
    byDate.set(key, entry);
  }

  const days = Array.from(byDate.values())
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 30);

  return (
    <>
      <AppHeader active="/history" userName={session?.user?.name} />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <h1 className="mb-4 text-xl font-bold text-slate-900">
          היסטוריית נוכחות
        </h1>

        {days.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
            עדיין לא נרשמה נוכחות.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {days.map((d) => (
              <li
                key={d.date}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <span className="font-semibold text-slate-800" dir="ltr">
                  {new Date(`${d.date}T00:00:00.000Z`).toLocaleDateString(
                    "he-IL",
                    { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" },
                  )}
                </span>
                <div className="flex gap-2 text-sm font-medium">
                  <span className="rounded-md bg-present/10 px-2 py-1 text-present">
                    נוכחים {d.present}
                  </span>
                  <span className="rounded-md bg-late/10 px-2 py-1 text-late">
                    איחורים {d.late}
                  </span>
                  <span className="rounded-md bg-absent/10 px-2 py-1 text-absent">
                    נעדרים {d.absent}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
