import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import { sessionCapabilities } from "@/lib/api-auth";
import { ROLE_LABEL, isRole } from "@/lib/roles";
import { loadMonthHours } from "@/lib/hours-query";
import { formatHebrewDate } from "@/lib/events";
import {
  currentMonth,
  hoursText,
  isMonth,
  missingHoursAlert,
  monthLabel,
  sessionsText,
  shiftMonth,
  summarizeMonth,
  totalHours,
} from "@/lib/hours";

export const dynamic = "force-dynamic";

// The monthly hours report (item 6).
//
// Navigation is links with a `?month=` rather than a picker component, and the
// per-person detail is a plain <details>. Both work before any JavaScript
// loads, which on a phone in the Golan is not a theoretical state — and this
// screen is read at the end of a month, often not from the field.
export default async function HoursReportPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const capabilities = await sessionCapabilities();
  if (!capabilities.includes("shift:view:own")) {
    return (
      <>
        <AppHeader
          active="/reports"
          userName={session.user.name}
          isAdmin={session.user.role === "admin"}
        />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
            אין לך הרשאה לצפות בשעות.
          </p>
        </main>
      </>
    );
  }

  // Same rule as the API: without `shift:view:all` this screen is the caller's
  // own month and nobody else's.
  const canViewAll = capabilities.includes("shift:view:all");

  // A month in the URL that is not a month falls back to this one rather than
  // erroring — a shared link with a truncated query should still open.
  const month =
    searchParams.month && isMonth(searchParams.month)
      ? searchParams.month
      : currentMonth();

  const rows = await loadMonthHours({
    month,
    userId: canViewAll ? null : session.user.id,
  });
  const people = summarizeMonth(rows);
  const total = totalHours(people);

  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  // There is nothing to see past this month: shifts are assigned ahead, but a
  // month that has not happened is not an hours report.
  const hasNext = next <= currentMonth();

  return (
    <>
      <AppHeader
        active="/reports"
        userName={session.user.name}
        isAdmin={session.user.role === "admin"}
      />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-900">שעות צוות</h1>
          <Link
            href="/reports"
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100"
          >
            דוח לפי ילד/ה
          </Link>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          {canViewAll
            ? "השעות נגזרות מהשיבוץ ומשעות המפגש. רק חריגים מוקלדים ידנית, במסך היום."
            : "השעות שלך, נגזרות מהשיבוץ ומשעות המפגש."}
        </p>

        {/* Month navigation. Arrows point the RTL way round: the previous
            month is to the right of the label, where it reads first. */}
        <nav className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-2">
          <MonthLink
            month={previous}
            label="‹ הקודם"
            title={monthLabel(previous)}
          />
          <span className="min-w-0 truncate text-center font-bold text-slate-900">
            {monthLabel(month)}
          </span>
          {hasNext ? (
            <MonthLink month={next} label="הבא ›" title={monthLabel(next)} />
          ) : (
            <span className="shrink-0 px-3 py-2 text-sm text-slate-300">
              הבא ›
            </span>
          )}
        </nav>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-white">
          <span className="text-sm text-slate-300">
            {people.length === 0
              ? "אין שיבוצים בחודש זה"
              : canViewAll
                ? `${people.length === 1 ? "איש/אשת צוות אחד/ת" : `${people.length} אנשי צוות`}`
                : "סך השעות שלי"}
          </span>
          <span className="text-lg font-bold" dir="rtl">
            {hoursText(total)}
          </span>
        </div>

        {people.length > 0 && (
          <a
            href={`/api/reports/hours/export?month=${month}`}
            className="mb-3 block rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-semibold text-slate-700 hover:bg-slate-50"
          >
            ⬇ הורדת הדוח (xlsx)
          </a>
        )}

        {people.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
            לא שובצו משמרות בחודש זה.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {people.map((person) => {
              const alert = missingHoursAlert(person);
              return (
                <li
                  key={person.userId}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <details>
                    <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="font-medium text-slate-900">
                          {person.name}
                        </span>
                        {canViewAll && (
                          <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                            {isRole(person.userRole)
                              ? ROLE_LABEL[person.userRole]
                              : person.userRole}
                          </span>
                        )}
                        <span className="mt-0.5 block text-sm text-slate-500">
                          {sessionsText(person.dayCount)}
                          {/* The count of unpriced sessions rides the collapsed
                              line, not only the panel inside. A warning you
                              have to open a drawer to see is a warning nobody
                              reads — the same reason the staffing alert sits in
                              the day's header. */}
                          {person.missingHoursDays > 0 && (
                            <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              {person.missingHoursDays === 1
                                ? "מפגש בלי שעות"
                                : `${person.missingHoursDays} מפגשים בלי שעות`}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-lg font-bold text-slate-900">
                        {person.totalHours}
                      </span>
                    </summary>

                    {alert && (
                      <p className="mx-4 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                        {alert}
                      </p>
                    )}

                    <ul className="border-t border-slate-100">
                      {person.days.map((day) => (
                        <li
                          key={`${person.userId}-${day.date}`}
                          className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 last:border-b-0"
                        >
                          <span className="min-w-0">
                            <span className="text-sm font-medium text-slate-700">
                              {formatHebrewDate(day.date)}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-slate-400">
                              {day.eventName}
                              {day.role && ` · ${day.role}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-left">
                            <span
                              className={`block text-sm font-semibold ${
                                day.hours === 0
                                  ? "text-late"
                                  : "text-slate-700"
                              }`}
                            >
                              {day.hours === 0 ? "בלי שעות" : day.hours}
                            </span>
                            {day.startTime && day.endTime && (
                              <span
                                className="block text-xs text-slate-400"
                                dir="ltr"
                              >
                                {day.startTime}–{day.endTime}
                              </span>
                            )}
                            {/* Next to the number it explains, and out of the
                                truncating line: on the one row where the hours
                                differ from the session's, "why" is the whole
                                point of showing the row at all. */}
                            {day.overridden && (
                              <span className="block text-xs font-semibold text-slate-500">
                                חריג ידני
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-4 text-xs text-slate-400">
          המערכת מחזיקה שעות בלבד, בלי תעריפים ובלי סכומים — חישוב השכר נעשה
          במקום שבו הוא נעשה היום.
        </p>
      </main>
    </>
  );
}

function MonthLink({
  month,
  label,
  title,
}: {
  month: string;
  label: string;
  title: string;
}) {
  return (
    <Link
      href={`/reports/hours?month=${month}`}
      title={title}
      className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
    >
      {label}
    </Link>
  );
}
