"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventKind, WeekdayTemplate } from "@/lib/events";
import ScheduleFields, {
  toRequestBody,
  validateSchedule,
  type ScheduleState,
  type WeekdayRow,
} from "./ScheduleFields";

export type EventSettingsData = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  kind: EventKind;
  includeFriday: boolean;
  includeSaturday: boolean;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  weekdays: WeekdayTemplate[];
};

function scheduleOf(event: EventSettingsData): ScheduleState {
  const weekdays: Record<number, WeekdayRow> = {};
  for (const w of event.weekdays) {
    weekdays[w.weekday] = { startTime: w.startTime, endTime: w.endTime };
  }
  return {
    kind: event.kind,
    includeFriday: event.includeFriday,
    includeSaturday: event.includeSaturday,
    defaultStartTime: event.defaultStartTime ?? "",
    defaultEndTime: event.defaultEndTime ?? "",
    weekdays,
  };
}

// Edit an existing event: rename it, or stretch/shrink its date range when a
// camp gets extended or cut short. Days that already hold attendance or a
// schedule are never dropped — the server reports them back and we say so.
export default function EventSettings({ event }: { event: EventSettingsData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(event.name);
  const [startDate, setStartDate] = useState(event.startDate);
  const [endDate, setEndDate] = useState(event.endDate);
  const [schedule, setSchedule] = useState<ScheduleState>(() =>
    scheduleOf(event),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!name.trim() || !startDate || !endDate) {
      setError("יש למלא שם, תאריך התחלה ותאריך סיום");
      return;
    }
    const scheduleError = validateSchedule(schedule, startDate, endDate);
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          startDate,
          endDate,
          ...toRequestBody(schedule),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "שמירת האירוע נכשלה");

      const parts: string[] = [];
      if (data?.added) parts.push(`נוספו ${data.added} ימים`);
      if (data?.removed) parts.push(`הוסרו ${data.removed} ימים`);
      if (data?.retimed) parts.push(`עודכנו שעות ב-${data.retimed} ימים`);
      if (data?.keptWithData)
        parts.push(`${data.keptWithData} ימים עם נתונים נשמרו ולא נמחקו`);
      setNotice(parts.length ? parts.join(" · ") : "נשמר");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-right"
      >
        <span className="font-bold text-slate-900">הגדרות האירוע</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <form onSubmit={save} className="flex flex-col gap-3 border-t border-slate-100 p-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            שם האירוע
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>

          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
              מתאריך
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-2 text-base"
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
              עד תאריך
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-2 text-base"
              />
            </label>
          </div>

          <ScheduleFields
            state={schedule}
            onChange={setSchedule}
            startDate={startDate}
            endDate={endDate}
            compact
          />

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {notice}
            </p>
          )}

          <p className="text-xs text-slate-400">
            שינוי הטווח או ימי השבוע מוסיף ימים חסרים. ימים שכבר יש בהם נוכחות
            או לוז לא יימחקו גם אם הם מחוץ לתבנית החדשה. שינוי שעות מתעדכן רק
            בימים שלא שונו ידנית.
          </p>

          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {busy ? "שומר…" : "שמירת שינויים"}
          </button>
        </form>
      )}
    </div>
  );
}
