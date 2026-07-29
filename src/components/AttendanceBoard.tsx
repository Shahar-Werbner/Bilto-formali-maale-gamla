"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { STATUSES, STATUS_LABEL, type Status } from "@/lib/attendance";

type Participant = { id: string; name: string };
type Group = { id: string; name: string; participants: Participant[] };

function localToday(): string {
  // en-CA gives YYYY-MM-DD in the viewer's local timezone.
  return new Date().toLocaleDateString("en-CA");
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

export default function AttendanceBoard({ groups }: { groups: Group[] }) {
  const [date, setDate] = useState<string>(localToday());
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/attendance?date=${d}`, {
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
    loadDay(date);
  }, [date, loadDay]);

  async function setStatus(participantId: string, status: Status) {
    const prev = statuses[participantId];
    setStatuses((s) => ({ ...s, [participantId]: status })); // optimistic
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, date, status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // revert on failure
      setStatuses((s) => {
        const next = { ...s };
        if (prev) next[participantId] = prev;
        else delete next[participantId];
        return next;
      });
      setError("השמירה נכשלה, נסו שוב");
    }
  }

  async function markGroup(groupId: string, status: Status) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const prev = { ...statuses };
    setStatuses((s) => {
      const next = { ...s };
      for (const p of group.participants) next[p.id] = status;
      return next;
    });
    try {
      const res = await fetch("/api/attendance/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, date, status }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setStatuses(prev);
      setError("השמירה נכשלה, נסו שוב");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          תאריך
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </label>
        {loading && <span className="text-sm text-slate-400">טוען…</span>}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
          אין עדיין קבוצות.{" "}
          <Link href="/roster" className="font-semibold text-slate-900 underline">
            הוספת קבוצה
          </Link>
        </div>
      )}

      {groups.map((group) => (
        <section
          key={group.id}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-lg font-bold text-slate-900">{group.name}</h2>
            <button
              onClick={() => markGroup(group.id, "present")}
              className="rounded-lg bg-present/10 px-3 py-2 text-sm font-semibold text-present hover:bg-present/20"
            >
              סמן הכל נוכח
            </button>
          </div>

          {group.participants.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-400">אין משתתפים בקבוצה</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {group.participants.map((p) => {
                const current = statuses[p.id];
                return (
                  <li
                    key={p.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium text-slate-800">{p.name}</span>
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
      ))}
    </div>
  );
}
