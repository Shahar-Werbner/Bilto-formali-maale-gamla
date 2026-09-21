"use client";

import { useCallback, useEffect, useState } from "react";
import type { Capability } from "@/lib/roles";
import {
  PREFILL_SOURCES,
  PREFILL_SOURCE_LABEL,
  splitSummary,
  type PrefillSource,
} from "@/lib/day-groups";
import { formatHebrewDate } from "@/lib/events";

export type DayGroup = { id: string; name: string; deleted?: boolean };

export type DayGroupChild = {
  participantId: string;
  name: string;
  grade: string | null;
  groupId: string | null;
};

// Who is in which group, for one session.
//
// The split changes every week here, so this screen is used at the start of a
// day and corrected during it. Two things shape it:
//
// A day with no assignments says "טרם חולק" and nothing else. It would be
// easy — and wrong — to show everyone in their standing group: the screen
// would then look identical whether the split had been done or forgotten.
//
// And the split is 40 children on a phone, so the three prefill buttons do the
// bulk of it and the list below is for the handful they cannot place. Prefill
// never overwrites a child who already has a group, so pressing it twice, or
// after a few manual fixes, is safe.
export default function DayGroupsBoard({
  eventDayId,
  capabilities = [],
}: {
  eventDayId: string;
  capabilities?: readonly Capability[];
}) {
  const canEdit = capabilities.includes("group:edit");
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<DayGroup[]>([]);
  const [children, setChildren] = useState<DayGroupChild[]>([]);
  const [previousDay, setPreviousDay] = useState<{ date: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/day-groups?eventDayId=${eventDayId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGroups(data.groups ?? []);
      setChildren(data.children ?? []);
      setPreviousDay(data.previousDay ?? null);
    } catch {
      setError("שגיאה בטעינת החלוקה לקבוצות");
    } finally {
      setLoading(false);
    }
  }, [eventDayId]);

  // Loaded even while collapsed: the header carries the state of the split
  // ("טרם חולק" / how many are placed), and that is the part someone opening
  // the day needs to see without tapping anything.
  useEffect(() => {
    load();
  }, [load]);

  async function assign(participantId: string, groupId: string) {
    setBusyId(participantId);
    setError(null);
    try {
      const res = groupId
        ? await fetch("/api/day-groups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventDayId, participantId, groupId }),
          })
        : await fetch(
            `/api/day-groups?eventDayId=${eventDayId}&participantId=${participantId}`,
            { method: "DELETE" },
          );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "");
      }
      // Only what the server confirmed, same as the dismissal screen: a child
      // shown in a group nobody recorded is worse than one shown unplaced.
      setChildren((list) =>
        list.map((c) =>
          c.participantId === participantId
            ? { ...c, groupId: groupId || null }
            : c,
        ),
      );
    } catch (err) {
      setError(
        `השיבוץ לא נשמר${err instanceof Error && err.message ? ` — ${err.message}` : ""}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function prefill(source: PrefillSource) {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/day-groups/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventDayId, source }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "");
      setNotice(
        `שובצו ${data.filled}` +
          (data.kept ? ` · ${data.kept} כבר היו משובצים ולא שונו` : "") +
          (data.unmatched ? ` · ${data.unmatched} נשארו ללא קבוצה` : ""),
      );
      await load();
    } catch (err) {
      setError(
        `המילוי נכשל${err instanceof Error && err.message ? ` — ${err.message}` : ""}`,
      );
    } finally {
      setWorking(false);
    }
  }

  async function clearAll() {
    if (
      !confirm(
        "לנקות את החלוקה של היום הזה? החברות הקבועה בקבוצות לא תשתנה.",
      )
    )
      return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/day-groups?eventDayId=${eventDayId}&all=1`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      setChildren((list) => list.map((c) => ({ ...c, groupId: null })));
      setNotice("החלוקה של היום נוקתה");
    } catch {
      setError("הניקוי נכשל");
    } finally {
      setWorking(false);
    }
  }

  const summary = splitSummary(children, groups);
  const assignable = groups.filter((g) => !g.deleted);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-right"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-bold text-slate-900">
            חלוקה לקבוצות {loading && <span className="text-slate-400">…</span>}
          </span>
          {!loading &&
            (summary.notSplit ? (
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">
                טרם חולק
              </span>
            ) : (
              <span className="rounded-md bg-present/10 px-2 py-1 text-xs font-semibold text-present">
                שובצו {summary.assigned} מתוך {children.length}
              </span>
            ))}
        </span>
        <span className="shrink-0 text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {canEdit && (
            <div className="flex flex-col gap-2 border-b border-slate-100 p-3">
              <div className="flex flex-wrap gap-2">
                {PREFILL_SOURCES.map((source) => {
                  const noPrevious = source === "previous" && !previousDay;
                  return (
                    <button
                      key={source}
                      onClick={() => prefill(source)}
                      disabled={working || noPrevious}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {PREFILL_SOURCE_LABEL[source]}
                      {source === "previous" && previousDay
                        ? ` (${formatHebrewDate(previousDay.date)})`
                        : ""}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500">
                מילוי מוסיף רק למי שעוד לא שובץ/ה — מי שכבר שובץ/ה לא ישתנה.
              </p>
              {summary.assigned > 0 && (
                <button
                  onClick={clearAll}
                  disabled={working}
                  className="w-fit rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-red-50 hover:text-absent disabled:opacity-40"
                >
                  ניקוי החלוקה של היום
                </button>
              )}
            </div>
          )}

          {(error || notice) && (
            <p
              className={`px-4 py-2 text-sm ${
                error ? "text-red-700" : "text-slate-600"
              }`}
            >
              {error ?? notice}
            </p>
          )}

          {summary.perGroup.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 py-3 text-xs font-semibold">
              {summary.perGroup.map((g) => (
                <span
                  key={g.groupId}
                  className="rounded-md bg-slate-100 px-2 py-1 text-slate-700"
                >
                  {g.name} {g.count}
                </span>
              ))}
              {summary.unassigned > 0 && (
                <span className="rounded-md bg-late/10 px-2 py-1 text-late">
                  ללא קבוצה {summary.unassigned}
                </span>
              )}
            </div>
          )}

          {children.length === 0 && !loading && (
            <p className="px-4 py-4 text-sm text-slate-400">
              אין משתתפים באירוע זה
            </p>
          )}

          {children.length > 0 && summary.notSplit && (
            <p className="px-4 pb-3 pt-1 text-sm text-slate-500">
              היום הזה טרם חולק לקבוצות. החברות הקבועה בקבוצות היא נקודת התחלה
              בלבד — אף ילד/ה לא משובץ/ת ליום הזה עד שמשבצים.
            </p>
          )}

          {groups.length === 0 && children.length > 0 && (
            <p className="px-4 pb-3 text-sm text-slate-500">
              אין קבוצות להשתבץ אליהן. אפשר ליצור קבוצות במסך הילדים.
            </p>
          )}

          <ul>
            {children.map((c, i) => {
              const group = groups.find((g) => g.id === c.groupId);
              return (
                <li
                  key={c.participantId}
                  className={`flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2 ${
                    i % 2 === 1 ? "bg-slate-50" : "bg-white"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2 font-medium text-slate-800">
                    <span className="truncate">{c.name}</span>
                    {c.grade && (
                      <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {c.grade}
                      </span>
                    )}
                  </span>

                  {canEdit ? (
                    <select
                      value={c.groupId ?? ""}
                      disabled={busyId === c.participantId}
                      onChange={(e) => assign(c.participantId, e.target.value)}
                      aria-label={`קבוצה של ${c.name}`}
                      className="w-36 shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm disabled:opacity-50"
                    >
                      <option value="">— ללא קבוצה —</option>
                      {assignable.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                      {/* A group deleted after this day was split stays
                          selectable-as-current so the row shows the truth. */}
                      {group?.deleted && (
                        <option value={group.id}>{group.name} (נמחקה)</option>
                      )}
                    </select>
                  ) : (
                    <span
                      className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${
                        group
                          ? "bg-slate-100 text-slate-700"
                          : "bg-late/10 text-late"
                      }`}
                    >
                      {group ? group.name : "ללא קבוצה"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
