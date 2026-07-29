import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import DeleteEventButton from "@/components/DeleteEventButton";
import { formatDateOnly } from "@/lib/attendance";
import { formatHebrewDate } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const session = await auth();

  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { days: true, participants: true } } },
  });

  return (
    <>
      <AppHeader active="/events" userName={session?.user?.name} />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">אירועים</h1>
          <Link
            href="/events/new"
            className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
          >
            + אירוע חדש
          </Link>
        </div>

        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
            אין עדיין אירועים. פתחו אירוע ראשון (למשל קייטנה).
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <Link href={`/events/${e.id}`} className="min-w-0 flex-1">
                  <div className="font-bold text-slate-900">{e.name}</div>
                  <div className="text-sm text-slate-500" dir="ltr">
                    {formatHebrewDate(formatDateOnly(e.startDate))} –{" "}
                    {formatHebrewDate(formatDateOnly(e.endDate))}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {e._count.days} ימים · {e._count.participants} משתתפים
                  </div>
                </Link>
                <DeleteEventButton id={e.id} name={e.name} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
