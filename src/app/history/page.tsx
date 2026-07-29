import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import { formatDateOnly, type Status } from "@/lib/attendance";
import { formatHebrewDate } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await auth();

  // Event-days that have any attendance recorded, most recent first.
  const days = await prisma.eventDay.findMany({
    where: { attendance: { some: {} } },
    orderBy: { date: "desc" },
    take: 60,
    include: {
      event: { select: { name: true } },
      attendance: { select: { status: true } },
    },
  });

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
            {days.map((d) => {
              let present = 0;
              let late = 0;
              let absent = 0;
              for (const r of d.attendance) {
                if (r.status === ("present" satisfies Status)) present++;
                else if (r.status === ("late" satisfies Status)) late++;
                else if (r.status === ("absent" satisfies Status)) absent++;
              }
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800" dir="ltr">
                      {formatHebrewDate(formatDateOnly(d.date))}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {d.event.name}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2 text-sm font-medium">
                    <span className="rounded-md bg-present/10 px-2 py-1 text-present">
                      נוכחים {present}
                    </span>
                    <span className="rounded-md bg-late/10 px-2 py-1 text-late">
                      איחורים {late}
                    </span>
                    <span className="rounded-md bg-absent/10 px-2 py-1 text-absent">
                      נעדרים {absent}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
