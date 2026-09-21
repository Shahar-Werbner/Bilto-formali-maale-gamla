"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  STATUSES,
  STATUS_LABEL,
  sortByGrade,
  todayDateOnly,
  type Status,
} from "@/lib/attendance";
import { formatHebrewDate, formatTimeRange, hoursBetween } from "@/lib/events";
import type { Capability } from "@/lib/roles";
import DaySchedule, { type Slot } from "./DaySchedule";
import DayGroupsBoard from "./DayGroupsBoard";
import ShiftBoard from "./ShiftBoard";
import DismissalBoard from "./DismissalBoard";
import EventSettings, { type EventSettingsData } from "./EventSettings";
import SaveStatus from "./SaveStatus";
import {
  createQueue,
  PermanentSendError,
  type AttendanceQueue,
  type PendingMark,
} from "@/lib/offline-queue";

type Participant = { id: string; name: string; grade?: string | null };
type Day = {
  id: string;
  date: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  /** What the parents said through their links (item 5). */
  expected?: { coming: number; notComing: number };
};
type Group = { id: string; name: string; memberIds: string[] };
type EventData = EventSettingsData & {
  participants: Participant[];
  days: Day[];
};

// A multi-day camp opened on day 1 every time meant scrolling to today before
// marking anything. Pick the day that matches today, else the nearest one.
function defaultDayId(days: Day[]): string {
  if (days.length === 0) return "";
  const today = todayDateOnly();
  const exact = days.find((d) => d.date === today);
  if (exact) return exact.id;
  return days.reduce((best, d) =>
    Math.abs(Date.parse(d.date) - Date.parse(today)) <
    Math.abs(Date.parse(best.date) - Date.parse(today))
      ? d
      : best,
  ).id;
}

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
  capabilities = [],
}: {
  event: EventData;
  groups: Group[];
  slotsByDay: Record<string, Slot[]>;
  allParticipants: Participant[];
  capabilities?: readonly Capability[];
}) {
  // A youth counselor comes here to mark attendance. Reshaping the event and
  // rewriting the day's schedule are adult jobs, and the routes behind those
  // controls refuse them anyway.
  const canEditEvent = capabilities.includes("event:edit");
  const canEditSchedule = capabilities.includes("schedule:edit");
  const canProposeSchedule = capabilities.includes("schedule:propose");
  const canApproveSchedule = capabilities.includes("schedule:approve");
  const canSeeShifts = capabilities.includes("shift:view:own");
  const canSeeDismissal = capabilities.includes("dismissal:view");
  const canSeeGroups = capabilities.includes("group:view");
  const [selectedDayId, setSelectedDayId] = useState<string>(() =>
    defaultDayId(event.days),
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
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const queueRef = useRef<AttendanceQueue | null>(null);
  // Holds the ids that were unmarked when the filter was switched on. Filtering
  // live would make each row vanish the moment it is marked, shifting the list
  // under the next tap — on a phone that means marking the wrong child.
  const [unmarkedFilter, setUnmarkedFilter] = useState<string[] | null>(null);

  // The day strip scrolls, and the day we auto-select is often not the first
  // one — bring it into view so it is clear which day is open.
  const dayStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dayStripRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedDayId]);

  const selectedDay = useMemo(
    () => event.days.find((d) => d.id === selectedDayId),
    [event.days, selectedDayId],
  );

  // One queue for the whole board, created on the client only (localStorage
  // does not exist during server rendering).
  useEffect(() => {
    if (queueRef.current) return;
    queueRef.current = createQueue({
      storage: window.localStorage,
      onChange: (marks: PendingMark[]) => setPending(marks.length),
      onDropped: (mark, err) => {
        // The server refused it for good — say so instead of leaving a tick
        // the user believes was saved.
        setError(`סימון אחד לא נשמר: ${err.message}`);
        setStatuses((s) => {
          const next = { ...s };
          delete next[mark.participantId];
          return next;
        });
      },
      send: async (mark) => {
        const res = await fetch("/api/event-attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventDayId: mark.eventDayId,
            participantId: mark.participantId,
            status: mark.status,
          }),
        });
        if (res.ok) return;
        // 4xx means this mark will never succeed; anything else is worth
        // retrying when the connection is better.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          const data = await res.json().catch(() => null);
          throw new PermanentSendError(data?.error ?? "נדחה על ידי השרת");
        }
        throw new Error(`שגיאת שרת (${res.status})`);
      },
    });
    setPending(queueRef.current.pending().length);
    setOnline(navigator.onLine);
    void queueRef.current.flush();
  }, []);

  // Drain when the connection comes back, and keep trying while it is down —
  // `online` lies often enough (captive portals, flaky mobile data) that a
  // slow poll is the honest backstop.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void queueRef.current?.flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const timer = setInterval(() => {
      if (queueRef.current?.pending().length) void queueRef.current.flush();
    }, 15000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(timer);
    };
  }, []);

  // A tab closed with marks still queued would lose them silently.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (queueRef.current?.pending().length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

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
      const fromServer: Record<string, Status> = data.byParticipant ?? {};
      // Anything still queued for this day is newer than what the server just
      // returned, so it wins — otherwise switching days would visibly undo
      // taps that simply have not been sent yet.
      for (const mark of queueRef.current?.pending() ?? []) {
        if (mark.eventDayId === dayId) fromServer[mark.participantId] = mark.status;
      }
      setStatuses(fromServer);
    } catch {
      setError("שגיאה בטעינת הנתונים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnmarkedFilter(null);
    loadDay(selectedDayId);
  }, [selectedDayId, loadDay]);

  // The tap is recorded locally and then sent. It is never rolled back on a
  // network failure — that is what used to lose a day's work in the field.
  function setStatus(participantId: string, status: Status) {
    setStatuses((s) => ({ ...s, [participantId]: status }));
    queueRef.current?.enqueue({
      eventDayId: selectedDayId,
      participantId,
      status,
    });
    void queueRef.current?.flush();
  }

  // Queues one mark per child. Used when the single bulk request cannot go out.
  function queueMany(ids: string[], status: Status) {
    for (const participantId of ids) {
      queueRef.current?.enqueue({
        eventDayId: selectedDayId,
        participantId,
        status,
      });
    }
    void queueRef.current?.flush();
  }

  // One request for the whole group when the network allows it; otherwise the
  // marks go into the queue individually and drain later.
  async function markAll(status: Status) {
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
      queueMany(
        participants.map((p) => p.id),
        status,
      );
    }
  }

  // The common end-of-day move: everyone left unmarked was not there.
  async function markRemaining(status: Status) {
    const remaining = participants
      .filter((p) => !statuses[p.id])
      .map((p) => p.id);
    if (remaining.length === 0) return;
    setStatuses((s) => {
      const next = { ...s };
      for (const id of remaining) next[id] = status;
      return next;
    });
    try {
      const res = await fetch("/api/event-attendance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventDayId: selectedDayId,
          status,
          participantIds: remaining,
        }),
      });
      if (!res.ok) throw new Error();
    } catch {
      queueMany(remaining, status);
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

  async function addGroupMembers(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const toAdd = group.memberIds.filter(
      (id) => !participants.some((p) => p.id === id),
    );
    if (toAdd.length === 0) {
      setError("כל חברי הקבוצה כבר באירוע");
      return;
    }
    const newOnes = allParticipants.filter((p) => toAdd.includes(p.id));
    const prev = participants;
    setParticipants((cur) => sortByGrade([...cur, ...newOnes]));
    try {
      const res = await fetch(`/api/events/${event.id}/participants/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantIds: toAdd }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setParticipants(prev);
      setError("הוספת הקבוצה נכשלה");
    }
  }

  const nonMembers = sortByGrade(
    allParticipants.filter((p) => !participants.some((m) => m.id === p.id)),
  );

  const summary = participants.reduce(
    (acc, p) => {
      const st = statuses[p.id];
      if (st) acc[st]++;
      else acc.unmarked++;
      return acc;
    },
    { present: 0, late: 0, absent: 0, unmarked: 0 },
  );

  const visible = unmarkedFilter
    ? participants.filter((p) => unmarkedFilter.includes(p.id))
    : participants;

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

      {canEditEvent && <EventSettings event={event} />}

      {/* Manage participants */}
      {canEditEvent && (
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

            {groups.length > 0 && (
              <select
                value=""
                onChange={(e) =>
                  e.target.value && addGroupMembers(e.target.value)
                }
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
              >
                <option value="">+ הוספת קבוצה שלמה לאירוע…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.memberIds.length})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      )}

      {/* Day selector */}
      <div
        ref={dayStripRef}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        {event.days.map((d) => {
          const active = d.id === selectedDayId;
          return (
            <button
              key={d.id}
              data-selected={active}
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* The hours of the session, not decoration: staff hours are derived
              from them, so a wrong pair has to be visible on the day itself. */}
          {formatTimeRange(selectedDay.startTime, selectedDay.endTime) ? (
            <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
              <span dir="ltr">
                {formatTimeRange(selectedDay.startTime, selectedDay.endTime)}
              </span>
              {" · "}
              {hoursBetween(selectedDay.startTime, selectedDay.endTime)} שעות
            </span>
          ) : (
            <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-400">
              לא הוגדרו שעות ליום זה
            </span>
          )}
          {/* The expected head count (item 5) — the number the kitchen cooks
              to. It is the roster minus the children a parent actively said
              were not coming: silence counts as coming, because cooking for
              four too many is leftovers and counting four out who then arrive
              is not. Shown only once a family has answered; before that it
              would just be the roster wearing a different label. */}
          {selectedDay.expected &&
            selectedDay.expected.coming + selectedDay.expected.notComing > 0 && (
              <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700">
                <span className="font-semibold">
                  צפויים: {event.participants.length - selectedDay.expected.notComing}
                </span>
                {` מתוך ${event.participants.length}`}
                {selectedDay.expected.notComing > 0 &&
                  ` · ${selectedDay.expected.notComing} הודיעו שלא מגיעים`}
              </span>
            )}

          <a
            href={`/api/event-days/${selectedDayId}/export`}
            className="inline-flex w-fit items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ⬇ ייצוא היום הנבחר
          </a>
        </div>
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
              readOnly={!canEditSchedule}
              placeholder="מה עשינו היום? (יתווסף בעתיד גם עם AI)"
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>

          {/* Day schedule */}
          {/* Keys are prefixed per component, not the bare day id. Three
              siblings keyed `selectedDayId` are three children with the SAME
              key, which React cannot reconcile: switching days left the
              previous day's schedule on screen above the new one, still wired
              to the old day. Any further per-day section needs its own
              prefix. */}
          <DaySchedule
            key={`schedule-${selectedDayId}`}
            eventDayId={selectedDayId}
            initialSlots={slotsByDay[selectedDayId] ?? []}
            groups={groups}
            canEdit={canEditSchedule}
            canPropose={canProposeSchedule}
            canApprove={canApproveSchedule}
          />

          {/* Who is working today, and whether that is enough people. Above
              the children's split because it is the earlier question: you
              cannot split 40 children across staff you do not have. Remounted
              per day, like everything else here. */}
          {canSeeShifts && (
            <ShiftBoard
              key={`shifts-${selectedDayId}`}
              eventDayId={selectedDayId}
              capabilities={capabilities}
            />
          )}

          {/* Who is in which group today. Above attendance because it is the
              first thing done with the children once they arrive, and below
              the schedule because the schedule is what the groups rotate
              through. Remounted per day: a split belongs to one session. */}
          {canSeeGroups && (
            <DayGroupsBoard
              key={`groups-${selectedDayId}`}
              eventDayId={selectedDayId}
              capabilities={capabilities}
            />
          )}

          {/* Attendance */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-bold text-slate-900">
                  נוכחות {loading && <span className="text-slate-400">…</span>}
                  <SaveStatus pending={pending} online={online} />
                </span>
                <button
                  onClick={() => markAll("present")}
                  className="rounded-lg bg-present/10 px-3 py-2 text-sm font-semibold text-present hover:bg-present/20"
                >
                  סמן הכל נוכח
                </button>
              </div>

              {participants.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className="rounded-md bg-present/10 px-2 py-1 text-present">
                    נוכחים {summary.present}
                  </span>
                  <span className="rounded-md bg-late/10 px-2 py-1 text-late">
                    איחורים {summary.late}
                  </span>
                  <span className="rounded-md bg-absent/10 px-2 py-1 text-absent">
                    נעדרים {summary.absent}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">
                    לא סומנו {summary.unmarked}
                  </span>
                  {unmarkedFilter && summary.unmarked === 0 && (
                    <button
                      onClick={() => setUnmarkedFilter(null)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
                    >
                      הצג את כולם
                    </button>
                  )}
                  {summary.unmarked > 0 && (
                    <>
                      <button
                        onClick={() =>
                          setUnmarkedFilter((cur) =>
                            cur
                              ? null
                              : participants
                                  .filter((p) => !statuses[p.id])
                                  .map((p) => p.id),
                          )
                        }
                        className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
                      >
                        {unmarkedFilter ? "הצג את כולם" : "הצג רק לא מסומנים"}
                      </button>
                      <button
                        onClick={() => markRemaining("absent")}
                        className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
                      >
                        סמן את הנותרים כנעדרים
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {participants.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-400">
                אין משתתפים באירוע זה
              </p>
            ) : (
              <ul>
                {visible.map((p, i) => {
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

          {/* Signing out, below signing in: the same list, at the other end of
              the day. Remounted per day so a switch cannot leave one day's
              dismissals on screen under another day's heading. */}
          {canSeeDismissal && (
            <DismissalBoard
              key={`dismissal-${selectedDayId}`}
              eventDayId={selectedDayId}
              capabilities={capabilities}
            />
          )}
        </>
      )}
    </div>
  );
}
