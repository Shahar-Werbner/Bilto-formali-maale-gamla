"use client";

import { useCallback, useEffect, useState } from "react";
import type { Capability } from "@/lib/roles";
import { staffingAlert, staffingLabel, type Staffing } from "@/lib/shifts";

type Shift = {
  id: string;
  userId: string;
  name: string;
  userRole: string;
  userRoleLabel: string;
  role: string | null;
  note: string | null;
  startTime: string | null;
  endTime: string | null;
  hours: number;
  overridden: boolean;
};

type Candidate = { id: string; name: string; role: string; roleLabel: string };

// Who is working this session, and whether that is enough people.
//
// The alert is the reason this screen exists. "Are we short on Tuesday?" is
// asked every week and answered today by counting heads in a WhatsApp group,
// which is how a session ends up with four teenagers and no adult. So the
// header carries the answer whether or not anyone opens the section.
export default function ShiftBoard({
  eventDayId,
  capabilities = [],
}: {
  eventDayId: string;
  capabilities?: readonly Capability[];
}) {
  const canAssign = capabilities.includes("shift:assign");
  const canViewAll = capabilities.includes("shift:view:all");

  const [open, setOpen] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [ratio, setRatio] = useState<Staffing | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [day, setDay] = useState<{ startTime: string | null; endTime: string | null }>(
    { startTime: null, endTime: null },
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts?eventDayId=${eventDayId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setShifts(data.shifts ?? []);
      setRatio(data.ratio ?? null);
      setCandidates(data.candidates ?? []);
      setDay(data.day ?? { startTime: null, endTime: null });
    } catch {
      setError("שגיאה בטעינת שיבוץ הצוות");
    } finally {
      setLoading(false);
    }
  }, [eventDayId]);

  // Loaded even while collapsed: the header is the alert.
  useEffect(() => {
    load();
  }, [load]);

  async function assign(userId: string) {
    setBusyId(userId);
    setError(null);
    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventDayId, userId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "");
      // Reloaded rather than pushed into the list: the ratio moves with every
      // assignment, and a stale banner under a fresh list is the one thing
      // this screen must not show.
      await load();
    } catch (err) {
      setError(
        `השיבוץ לא נשמר${err instanceof Error && err.message ? ` — ${err.message}` : ""}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function saveHours(shift: Shift, startTime: string, endTime: string, role: string) {
    setBusyId(shift.userId);
    setError(null);
    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventDayId,
          userId: shift.userId,
          startTime,
          endTime,
          role,
          note: shift.note ?? "",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "");
      setEditingId(null);
      await load();
    } catch (err) {
      setError(
        `השמירה נכשלה${err instanceof Error && err.message ? ` — ${err.message}` : ""}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(shift: Shift) {
    if (!confirm(`להוריד את ${shift.name} מהשיבוץ ליום זה?`)) return;
    setBusyId(shift.userId);
    setError(null);
    try {
      const res = await fetch(`/api/shifts?id=${shift.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError("ההסרה נכשלה");
    } finally {
      setBusyId(null);
    }
  }

  const unassigned = candidates.filter(
    (c) => !shifts.some((s) => s.userId === c.id),
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-right"
      >
        <span className="min-w-0">
          <span className="font-bold text-slate-900">
            צוות היום {loading && <span className="text-slate-400">…</span>}
          </span>
          <span className="mt-0.5 block text-sm text-slate-500">
            {canViewAll
              ? ratio
                ? staffingLabel(ratio)
                : "—"
              : shifts.length > 0
                ? `המשמרת שלי: ${timeText(shifts[0])}`
                : "לא משובצ/ת ליום זה"}
          </span>
        </span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {/* The alert stays visible when the section is closed. A warning you have
          to open a drawer to see is a warning nobody reads. */}
      {canViewAll && ratio && staffingAlert(ratio) && (
        <p
          className={`mx-4 mb-3 rounded-lg px-3 py-2 text-sm font-semibold ${
            ratio.level === "none"
              ? "bg-red-50 text-red-700"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {staffingAlert(ratio)}
        </p>
      )}
      {canViewAll && ratio?.noAdult && (
        <p className="mx-4 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          אין בוגר/ת משובץ/ת ליום זה — כל המשובצים הם מדריכי נוער.
        </p>
      )}

      {open && (
        <div className="border-t border-slate-100 p-3">
          {error && (
            <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {shifts.length === 0 ? (
            <p className="mb-2 text-sm text-slate-400">
              {canViewAll ? "אף אחד לא משובץ ליום זה." : "לא שובצת ליום זה."}
            </p>
          ) : (
            <ul className="mb-2 flex flex-col gap-2">
              {shifts.map((s) =>
                editingId === s.id ? (
                  <li key={s.id}>
                    <HoursForm
                      shift={s}
                      day={day}
                      busy={busyId === s.userId}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(start, end, role) => saveHours(s, start, end, role)}
                    />
                  </li>
                ) : (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">{s.name}</span>
                      <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {s.userRoleLabel}
                      </span>
                      <span className="mt-0.5 block text-sm text-slate-500">
                        <span dir="ltr">{timeText(s)}</span>
                        {s.hours > 0 && ` · ${s.hours} שעות`}
                        {!s.overridden && " · שעות המפגש"}
                        {s.role && ` · ${s.role}`}
                      </span>
                    </span>
                    {canAssign && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          onClick={() => setEditingId(s.id)}
                          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
                        >
                          שעות
                        </button>
                        <button
                          onClick={() => remove(s)}
                          disabled={busyId === s.userId}
                          className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-red-50 hover:text-absent disabled:opacity-50"
                        >
                          הסרה
                        </button>
                      </span>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}

          {canAssign &&
            (unassigned.length > 0 ? (
              <select
                value=""
                disabled={busyId !== null}
                onChange={(e) => e.target.value && assign(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
              >
                <option value="">+ שיבוץ איש/אשת צוות ליום זה…</option>
                {unassigned.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.roleLabel})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-slate-400">כל הצוות כבר משובץ ליום זה.</p>
            ))}

          {canViewAll && ratio && (
            <p className="mt-2 text-xs text-slate-400">
              {ratio.childrenSource === "marked"
                ? "היחס מחושב מהנוכחות שסומנה היום."
                : ratio.childrenSource === "expected"
                  ? "היחס מחושב מהמספר הצפוי — הרשומים לאירוע פחות מי שההורים הודיעו שלא מגיע/ה."
                  : "היחס מחושב מכל הילדים הרשומים לאירוע, כל עוד הנוכחות לא סומנה במלואה."}{" "}
              {'את הסף משנים ב"הגדרות האירוע".'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function timeText(s: { startTime: string | null; endTime: string | null }): string {
  if (!s.startTime && !s.endTime) return "לא הוגדרו שעות";
  return `${s.startTime ?? "?"}–${s.endTime ?? "?"}`;
}

// Hours on a shift are an override, so the form starts empty when the shift
// follows the session and says what it will fall back to.
function HoursForm({
  shift,
  day,
  busy,
  onSubmit,
  onCancel,
}: {
  shift: Shift;
  day: { startTime: string | null; endTime: string | null };
  busy: boolean;
  onSubmit: (startTime: string, endTime: string, role: string) => void;
  onCancel: () => void;
}) {
  const [startTime, setStartTime] = useState(
    shift.overridden ? (shift.startTime ?? "") : "",
  );
  const [endTime, setEndTime] = useState(
    shift.overridden ? (shift.endTime ?? "") : "",
  );
  const [role, setRole] = useState(shift.role ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(startTime, endTime, role);
      }}
      className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3"
    >
      <span className="text-sm font-semibold text-slate-700">{shift.name}</span>
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col text-xs text-slate-500">
          משעה
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-2 text-base"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col text-xs text-slate-500">
          עד שעה
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-2 text-base"
          />
        </label>
      </div>
      <input
        value={role}
        onChange={(e) => setRole(e.target.value)}
        placeholder="תפקיד ביום (אחראי/ת, מדריך/ת קבוצה)"
        className="rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <p className="text-xs text-slate-400">
        שדה ריק = שעות המפגש
        {day.startTime && day.endTime ? (
          <>
            {" "}
            (<span dir="ltr">{`${day.startTime}–${day.endTime}`}</span>)
          </>
        ) : (
          " (לא הוגדרו ליום זה)"
        )}
        .
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {busy ? "שומר…" : "שמירה"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 font-medium text-slate-500 hover:bg-slate-100"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
