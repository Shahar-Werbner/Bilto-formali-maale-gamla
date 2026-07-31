"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  STATUSES,
  STATUS_LABEL,
  sortByGrade,
  type Status,
} from "@/lib/attendance";
import { formatHebrewDate } from "@/lib/events";
import DaySchedule, { type Slot } from "./DaySchedule";

type Participant = { id: string; name: string; grade?: string | null };
type Day = { id: string; date: string; description: string | null };
type Group = { id: string; name: string };
type EventData = {
  id: string;
  name: string;
  participants: Participant[];
  days: Day[];
};

const STATUS_STYLE: Record<Status, { active: string; idle: string }> = {
  present: {
    active: "bg-present text-white border-present",
    idle: "bg-white text-present border-slate-300",
  },
  late: {
    active: "bg-late text-white border-late",
    idle: "bg-white text-late border-slate-300",
  },
  absent: {
    active: "bg-absent text-white border-absent",
    idle: "bg-white text-absent border-slate-300",
  },
};

export default function EventBoard({
  event,
  groups,
  slotsByDay,
  allParticipants,
}: {
  event: EventData;
  groups: Group[];
  slotsByDay: Record<string, Slot[]>;
  allParticipants: Participant[];
}) {
  const [selectedDayId, setSelectedDayId] = useState<string>(
    event.days[0]?.id ?? "",
  );
  const [participants, setParticipants] = useState<Participant[]>(
    event.participants,
  );
  const [manageOpen, setManageOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>(
    () => {
      const init: Record<string, string> = {};
      for (const d of event.days) init[d.id] = d.description ?? "";
      return init;
    },
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDay = useMemo(
    () => event.days.find((d) => d.id === selectedDayId),
    [event.days, selectedDayId],
  );

  const loadDay = useCallback(async (dayId: string) => {
    if (!dayId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/event-attendance?eventDayId=${dayId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setStatuses(data.byParticipant ?? {});
    } catch {
      setError("שגיאה בטעינת הנתונים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDay(selectedDayId);
  }, [selectedDayId, loadDay]);

  async function setStatus(participantId: string, status: Status) {
    const prev = statuses[participantId];
    setStatuses((s) => ({ ...s, [participantId]: status }));
    try {
      const res = await fetch("/api/event-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventDayId: selectedDayId, participantId, status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setStatuses((s) => {
        const next = { ...s };
        if (prev) next[participantId] = prev;
        else delete next[participantId];
        return next;
      });
      setError("השמירה נכשלה, נסו שוב");
    }
  }

  async function markAll(status: Status) {
    const prev = { ...statuses };
    setStatuses(() => {
      const next: Record<string, Status> = {};
      for (const p of participants) next[p.id] = status;
      return next;
    });
    try {
      const res = await fetch("/api/event-attendance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventDayId: selectedDayId, status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setStatuses(prev);
      setError("השמירה נכשלה, נסו שוב");
    }
  }

  async function saveDescription(value: string) {
    setDescriptions((d) => ({ ...d, [selectedDayId]: value }));
    try {
      await fetch(`/api/event-days/${selectedDayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: value }),
      });
    } catch {
      setError("שמירת התיאור נכשלה");
    }
  }

  async function addParticipant(participantId: string) {
    const p = allParticipants.find((x) => x.id === participantId);
    if (!p) return;
    const prev = participants;
    setParticipants((cur) => sortByGrade([...cur, p]));
    try {
      const res = await fetch(`/api/events/${event.id}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setParticipants(prev);
      setError("הוספת המשתתף לאירוע נכשלה");
    }
  }

  async function removeParticipant(participantId: string) {
    if (!confirm("להסיר את הילד/ה מהאירוע? הנוכחות שלו/ה באירוע תימחק.")) return;
    const prev = participants;
    setParticipants((cur) => cur.filter((p) => p.id !== participantId));
    setStatuses((s) => {
      const next = { ...s };
      delete next[participantId];
      return next;
    });
    try {
      const res = await fetch(
        `/api/events/${event.id}/participants?participantId=${participantId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
    } catch {
      setParticipants(prev);
      setError("הסרת המשתתף מהאירוע נכשלה");
    }
  }

  const nonMembers = sortByGrade(
    allParticipants.filter((p) => !participants.some((m) => m.id === p.id)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">{event.name}</h1>
        <Link href="/events" className="text-sm text-slate-500 hover:underline">
          ← כל האירועים
        </Link>
      </div>

      <a
        href={`/api/events/${event.id}/export`}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        ⬇ ייצוא כל האירוע (Google Sheets / Excel)
      </a>

      {/* Manage participants */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <button
          onClick={() => setManageOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-right"
        >
          <span className="font-bold text-slate-900">
            משתתפים באירוע ({participants.length})
          </span>
          <span className="text-slate-400">{manageOpen ? "▲" : "▼"}</span>
        </button>
        {manageOpen && (
          <div className="border-t border-slate-100 p-3">
            <ul className="mb-2 flex flex-wrap gap-2">
              {participants.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pr-3 pl-1 text-sm"
                >
                  <span className="text-slate-800">
                    {p.name}
                    {p.grade ? ` · ${p.grade}` : ""}
                  </span>
                  <button
                    onClick={() => removeParticipant(p.id)}
                    aria-label={`הסרת ${p.name}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-absent"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {participants.length === 0 && (
                <li className="text-sm text-slate-400">אין משתתפים באירוע</li>
              )}
            </ul>
            {nonMembers.length > 0 ? (
              <select
                value=""
                onChange={(e) => e.target.value && addParticipant(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
              >
                <option value="">+ הוספת ילד/ה לאירוע…</option>
                {nonMembers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.grade ? ` (${p.grade})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-slate-400">כל הילדים כבר באירוע.</p>
            )}
          </div>
        )}
      </div>

      {/* Day selector */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {event.days.map((d) => {
          const active = d.id === selectedDayId;
          return (
            <button
              key={d.id}
              onClick={() => setSelectedDayId(d.id)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {formatHebrewDate(d.date)}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <a
          href={`/api/event-days/${selectedDayId}/export`}
          className="inline-flex w-fit items-center gap-1 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          ⬇ ייצוא היום הנבחר
        </a>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {selectedDay && (
        <>
          {/* Activity description */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <label className="text-sm font-medium text-slate-700">
              תיאור הפעילות ליום זה
            </label>
            <textarea
              value={descriptions[selectedDayId] ?? ""}
              onChange={(e) =>
                setDescriptions((d) => ({
                  ...d,
                  [selectedDayId]: e.target.value,
                }))
              }
              onBlur={(e) => saveDescription(e.target.value)}
              placeholder="מה עשינו היום? (יתווסף בעתיד גם עם AI)"
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>

          {/* Day schedule */}
          <DaySchedule
            key={selectedDayId}
            eventDayId={selectedDayId}
            initialSlots={slotsByDay[selectedDayId] ?? []}
            groups={groups}
          />

          {/* Attendance */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <span className="font-bold text-slate-900">
                נוכחות {loading && <span className="text-slate-400">…</span>}
              </span>
              <button
                onClick={() => markAll("present")}
                className="rounded-lg bg-present/10 px-3 py-2 text-sm font-semibold text-present hover:bg-present/20"
              >
                סמן הכל נוכח
              </button>
            </div>

            {participants.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-400">
                אין משתתפים באירוע זה
              </p>
            ) : (
              <ul>
                {participants.map((p, i) => {
                  const current = statuses[p.id];
                  return (
                    <li
                      key={p.id}
                      className={`flex flex-col gap-2 border-b border-slate-200 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between ${
                        i % 2 === 1 ? "bg-slate-50" : "bg-white"
                      }`}
                    >
                      <span className="flex items-center gap-2 font-medium text-slate-800">
                        {p.name}
                        {p.grade && (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                            {p.grade}
                          </span>
                        )}
                      </span>
                      <div className="flex gap-2">
                        {STATUSES.map((st) => {
                          const active = current === st;
                          const style = STATUS_STYLE[st];
                          return (
                            <button
                              key={st}
                              onClick={() => setStatus(p.id, st)}
                              aria-pressed={active}
                              className={`min-w-[72px] rounded-lg border px-3 py-2 text-sm font-semibold transition active:scale-95 ${
                                active ? style.active : style.idle
                              }`}
                            >
                              {STATUS_LABEL[st]}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
