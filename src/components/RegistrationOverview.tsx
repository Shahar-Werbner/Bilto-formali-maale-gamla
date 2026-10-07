"use client";

import { useState } from "react";
import { formatHebrewDate } from "@/lib/events";
import { REGISTRATION_STATUS_LABEL } from "@/lib/registration";
import { whatsappNameList } from "@/lib/registration-overview";
import type { RegistrationOverviewData } from "@/lib/registration-overview-server";

// Who has registered for this event, per day how many are coming and how many
// bring food, and who from the last event has not answered yet (item 8b).
//
// Read by an adult the evening before — and by a youth counselor, who sees
// names and numbers but no parent's name or phone (the server never sends
// them). The two "copy" buttons produce names only, for the parents' group.

export default function RegistrationOverview({
  eventName,
  data,
}: {
  eventName: string;
  data: RegistrationOverviewData;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const registered = data.children.filter(
    (c) => c.status === "approved" && c.comingDayIds.length > 0,
  );
  const notComing = data.children.filter(
    (c) => c.status === "approved" && c.comingDayIds.length === 0,
  );
  const queue = data.children.filter((c) => c.needsReview);
  const waitlist = data.children.filter((c) => c.status === "waitlist");
  const rejected = data.children.filter((c) => c.status === "rejected");
  const dayDate = new Map(data.days.map((d) => [d.id, d.date]));
  const multiDay = data.days.length > 1;

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      // Phones refuse the clipboard often enough that a dead button is worse
      // than showing the text to copy by hand.
      window.prompt("להעתקה:", text);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="סיכום ההרשמה">
      <div className="grid grid-cols-2 gap-2 min-[380px]:grid-cols-4">
        <Stat label="נרשמו" value={registered.length} tone="emerald" />
        <Stat label="ממתינים לאישור" value={queue.length} tone="amber" />
        <Stat label="רשימת המתנה" value={waitlist.length} tone="slate" />
        <Stat
          label="עוד לא נרשמו"
          value={data.previous ? data.previous.notRegistered.length : "—"}
          tone="slate"
        />
      </div>

      {data.days.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">לכל יום</h2>
          <p className="mb-2 text-xs text-slate-500">
            מגיעים — ומתוכם עם אוכל ובלי. &quot;בלי אוכל&quot; הם מי שהמטבח מבשל להם.
          </p>
          <ul className="flex flex-col divide-y divide-slate-100">
            {data.days.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{formatHebrewDate(d.date)}</span>
                <span className="text-slate-700">
                  <span className="font-bold">{d.food.coming}</span> מגיעים
                  {" · "}
                  {d.food.withFood} עם אוכל
                  {" · "}
                  <span className="font-semibold">{d.food.withoutFood} בלי</span>
                  {d.food.unknown > 0 && ` · ${d.food.unknown} לא ידוע`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.previous && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">
              עוד לא נרשמו ({data.previous.notRegistered.length})
            </h2>
            {data.previous.notRegistered.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  copy(
                    "missing",
                    whatsappNameList(
                      `עוד לא נרשמו ל${eventName}:`,
                      data.previous!.notRegistered.map((c) => c.name),
                    ),
                  )
                }
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                {copied === "missing" ? "✓ הועתק" : "העתק רשימה"}
              </button>
            )}
          </div>
          <p className="mb-2 text-xs text-slate-500">
            {data.previous.basis === "attended"
              ? `מי שהגיע/ה ל${data.previous.name}`
              : `מי שהיה/תה רשום/ה ל${data.previous.name} (לא סומנה שם נוכחות)`}{" "}
            ולא שלח/ה טופס. ההעתקה — שמות בלבד, להדבקה בקבוצה.
          </p>
          {data.previous.notRegistered.length === 0 ? (
            <p className="text-sm text-slate-500">כולם כבר ענו.</p>
          ) : (
            <NameList items={data.previous.notRegistered} />
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">נרשמו ({registered.length})</h2>
          {registered.length > 0 && (
            <button
              type="button"
              onClick={() =>
                copy(
                  "registered",
                  whatsappNameList(
                    `נרשמו ל${eventName}:`,
                    registered.map((c) => c.name),
                  ),
                )
              }
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              {copied === "registered" ? "✓ הועתק" : "העתק רשימה"}
            </button>
          )}
        </div>
        {registered.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">אף אחד עדיין.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-slate-100">
            {registered.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium text-slate-900">
                    {c.name}
                    {c.grade && <span className="font-normal text-slate-500"> · {c.grade}</span>}
                    {c.updated && (
                      <span className="ms-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        עודכן
                      </span>
                    )}
                  </span>
                  {multiDay && (
                    <span className="text-xs text-slate-500">
                      {c.comingDayIds.length === data.days.length
                        ? "כל הימים"
                        : c.comingDayIds
                            .map((id) => dayDate.get(id))
                            .filter((d): d is string => Boolean(d))
                            .sort()
                            .map((d) => formatHebrewDate(d))
                            .join(" · ")}
                    </span>
                  )}
                </div>
                {c.parentName && (
                  <span className="text-xs text-slate-500">
                    {c.parentName}
                    {c.parentPhone && (
                      <>
                        {" · "}
                        <a href={`tel:${c.parentPhone}`} dir="ltr" className="underline">
                          {c.parentPhone}
                        </a>
                      </>
                    )}
                  </span>
                )}
                {c.note && (
                  <p className="rounded-lg bg-late/10 px-3 py-1.5 text-xs text-late">
                    <span className="font-semibold">הערה: </span>
                    {c.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The queue itself is listed by name only on an adult's page, below —
          a child can be registered and still have a pickup change waiting,
          and two lists with the same name in both read as a contradiction. */}
      {(waitlist.length > 0 || notComing.length > 0 || rejected.length > 0) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          {[
            { label: REGISTRATION_STATUS_LABEL.waitlist, list: waitlist },
            { label: "ענו שלא מגיעים", list: notComing },
            { label: "נדחו", list: rejected },
          ]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <p key={g.label} className="py-1 text-slate-700">
                <span className="font-semibold">
                  {g.label} ({g.list.length}):
                </span>{" "}
                {g.list.map((c) => c.name).join(" · ")}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "emerald" | "amber" | "slate";
}) {
  const color =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-900"
      : tone === "amber"
        ? "bg-amber-50 text-amber-900"
        : "bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-xl px-3 py-2 ${color}`}>
      <div className="text-2xl font-bold leading-tight">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function NameList({ items }: { items: { id: string; name: string; grade: string | null }[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((c) => (
        <li key={c.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800">
          {c.name}
          {c.grade && <span className="text-slate-500"> · {c.grade}</span>}
        </li>
      ))}
    </ul>
  );
}
