"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type EventSettingsData = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  includeFriday: boolean;
  includeSaturday: boolean;
};

// Edit an existing event: rename it, or stretch/shrink its date range when a
// camp gets extended or cut short. Days that already hold attendance or a
// schedule are never dropped — the server reports them back and we say so.
export default function EventSettings({ event }: { event: EventSettingsData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(event.name);
  const [startDate, setStartDate] = useState(event.startDate);
  const [endDate, setEndDate] = useState(event.endDate);
  const [includeFriday, setIncludeFriday] = useState(event.includeFriday);
  const [includeSaturday, setIncludeSaturday] = useState(event.includeSaturday);
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
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          startDate,
          endDate,
          includeFriday,
          includeSaturday,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "שמירת האירוע נכשלה");

      const parts: string[] = [];
      if (data?.added) parts.push(`נוספו ${data.added} ימים`);
      if (data?.removed) parts.push(`הוסרו ${data.removed} ימים`);
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

          <div className="flex gap-4 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeFriday}
                onChange={(e) => setIncludeFriday(e.target.checked)}
                className="h-4 w-4"
              />
              כולל שישי
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeSaturday}
                onChange={(e) => setIncludeSaturday(e.target.checked)}
                className="h-4 w-4"
              />
              כולל שבת
            </label>
          </div>

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
            שינוי הטווח מוסיף ימים חסרים. ימים שכבר יש בהם נוכחות או לוז לא
            יימחקו גם אם הם מחוץ לטווח החדש.
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
