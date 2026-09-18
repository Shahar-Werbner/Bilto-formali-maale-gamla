"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ScheduleFields, {
  emptySchedule,
  toRequestBody,
  validateSchedule,
  type ScheduleState,
} from "./ScheduleFields";

type Participant = { id: string; name: string; grade?: string | null };

export default function NewEventForm({
  participants,
}: {
  participants: Participant[];
}) {
  const router = useRouter();

  const allIds = useMemo(
    () => participants.map((p) => p.id),
    [participants],
  );

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // A recurring weekly pattern is the common case here — the year is every
  // Tuesday and every Friday — so that is what the form opens on.
  const [schedule, setSchedule] = useState<ScheduleState>(emptySchedule);
  const [selected, setSelected] = useState<Set<string>>(new Set(allIds));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = selected.size === allIds.length && allIds.length > 0;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !startDate || !endDate) {
      setError("יש למלא שם, תאריך התחלה ותאריך סיום");
      return;
    }
    const scheduleError = validateSchedule(schedule, startDate, endDate);
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    if (selected.size === 0) {
      setError("יש לבחור לפחות משתתף אחד");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          startDate,
          endDate,
          ...toRequestBody(schedule),
          participantIds: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "");
      }
      const event = await res.json();
      router.push(`/events/${event.id}`);
    } catch (err) {
      setError((err as Error).message || "יצירת האירוע נכשלה");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <label className="mb-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
          שם האירוע
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="למשל: שנת פעילות תשפ״ז"
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          />
        </label>

        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
            מתאריך
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-3 text-base"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
            עד תאריך
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-3 text-base"
            />
          </label>
        </div>

        <div className="mt-4">
          <ScheduleFields
            state={schedule}
            onChange={setSchedule}
            startDate={startDate}
            endDate={endDate}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">
            משתתפים ({selected.size})
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
          >
            {allSelected ? "בטל הכל" : "בחר הכל"}
          </button>
        </div>

        {participants.length === 0 && (
          <p className="text-sm text-slate-400">
            אין ילדים. הוסיפו אותם קודם במסך קבוצות.
          </p>
        )}

        <div className="flex flex-col">
          {participants.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 rounded-lg px-2 py-2 text-slate-800 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                className="h-5 w-5"
              />
              {p.name}
              {p.grade && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                  {p.grade}
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
      >
        {busy ? "יוצר…" : "יצירת אירוע"}
      </button>
    </form>
  );
}
