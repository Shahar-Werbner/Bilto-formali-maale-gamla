"use client";

import { useCallback, useEffect, useState } from "react";
import type { Capability } from "@/lib/roles";
import {
  DISMISSAL_METHOD_LABEL,
  DISMISSAL_STATE_LABEL,
  dismissalState,
  type DismissalMethod,
} from "@/lib/dismissal";

export type PickupPerson = {
  id: string;
  name: string;
  relation: string | null;
  phone?: string | null;
};

export type DismissalChild = {
  participantId: string;
  name: string;
  grade: string | null;
  defaultDismissal: DismissalMethod;
  authorizations: PickupPerson[];
  /**
   * What the family said through their link this morning (item 5): whether the
   * child is coming, and anything they wanted the staff to know.
   *
   * It is a message, not a decision. Nothing here shortens what the person at
   * the gate has to do — a note saying "today grandma" still goes through the
   * adult who signs the child out, exactly as a phone call would.
   */
  parentSaid: { coming: boolean; note: string | null } | null;
  dismissal: {
    method: DismissalMethod;
    pickedUpByName: string | null;
    note: string | null;
    at: string | null;
  } | null;
};

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// The end of the day, on a phone, at the gate.
//
// Two things shape every decision here. The children are 6-9, so the list has
// to show at a glance who is still waiting — that number going to zero is how
// the team knows the day is over. And the person holding the phone is often
// fifteen, so a dismissal that needs an adult says so in words instead of
// failing a button.
//
// Writes do not go through the offline queue that attendance uses, on purpose:
// a dismissal can be legitimately *refused* by the server (a name that is not
// on the list), and a queue whose job is to retry until it lands is the wrong
// shape for a request that must be allowed to come back "no". Nothing is shown
// as recorded until the server says it is.
export default function DismissalBoard({
  eventDayId,
  capabilities = [],
}: {
  eventDayId: string;
  capabilities?: readonly Capability[];
}) {
  const canAuthorize = capabilities.includes("dismissal:authorize");
  const [children, setChildren] = useState<DismissalChild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [otherName, setOtherName] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dismissals?eventDayId=${eventDayId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setChildren(data.children ?? []);
    } catch {
      setError("שגיאה בטעינת רשימת השחרור");
    } finally {
      setLoading(false);
    }
  }, [eventDayId]);

  useEffect(() => {
    setOpenId(null);
    load();
  }, [load]);

  function closeRow() {
    setOpenId(null);
    setOtherName("");
    setNote("");
  }

  async function mark(
    participantId: string,
    body: { method: DismissalMethod; pickedUpByName?: string; note?: string },
  ) {
    setBusyId(participantId);
    setRowError((e) => {
      const next = { ...e };
      delete next[participantId];
      return next;
    });
    try {
      const res = await fetch("/api/dismissals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventDayId, participantId, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRowError((e) => ({
          ...e,
          [participantId]: data?.error ?? "השמירה נכשלה",
        }));
        return;
      }
      // Only what the server confirmed is shown as recorded.
      setChildren((list) =>
        list.map((c) =>
          c.participantId === participantId
            ? {
                ...c,
                dismissal: {
                  method: data.method,
                  pickedUpByName: data.pickedUpByName ?? null,
                  note: data.note ?? null,
                  at: data.at ?? null,
                },
              }
            : c,
        ),
      );
      closeRow();
    } catch {
      setRowError((e) => ({
        ...e,
        [participantId]: "אין חיבור — השחרור לא נשמר",
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function undo(participantId: string, name: string) {
    if (!confirm(`לבטל את סימון השחרור של ${name}?`)) return;
    setBusyId(participantId);
    try {
      const res = await fetch(
        `/api/dismissals?eventDayId=${eventDayId}&participantId=${participantId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      setChildren((list) =>
        list.map((c) =>
          c.participantId === participantId ? { ...c, dismissal: null } : c,
        ),
      );
    } catch {
      setRowError((e) => ({ ...e, [participantId]: "הביטול נכשל" }));
    } finally {
      setBusyId(null);
    }
  }

  const summary = children.reduce(
    (acc, c) => {
      acc[dismissalState(c.dismissal)]++;
      return acc;
    },
    { waiting: 0, alone: 0, collected: 0 },
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-slate-900">
            שחרור בסוף היום {loading && <span className="text-slate-400">…</span>}
          </span>
          <button
            onClick={load}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            רענון
          </button>
        </div>
        {children.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-md bg-late/10 px-2 py-1 text-late">
              מחכים {summary.waiting}
            </span>
            <span className="rounded-md bg-present/10 px-2 py-1 text-present">
              נאספו {summary.collected}
            </span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">
              יצאו לבד {summary.alone}
            </span>
          </div>
        )}
      </div>

      {error && (
        <p className="px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      {children.length === 0 && !loading ? (
        <p className="px-4 py-4 text-sm text-slate-400">אין משתתפים באירוע זה</p>
      ) : (
        <ul>
          {children.map((c, i) => {
            const state = dismissalState(c.dismissal);
            const open = openId === c.participantId;
            const busy = busyId === c.participantId;
            const aloneIsRoutine = c.defaultDismissal === "alone";
            return (
              <li
                key={c.participantId}
                className={`border-b border-slate-200 last:border-b-0 ${
                  i % 2 === 1 ? "bg-slate-50" : "bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <span className="flex min-w-0 flex-1 items-center gap-2 font-medium text-slate-800">
                    <span className="truncate">{c.name}</span>
                    {c.grade && (
                      <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {c.grade}
                      </span>
                    )}
                  </span>

                  {state === "waiting" ? (
                    <button
                      onClick={() => {
                        if (open) closeRow();
                        else {
                          // The free-text fields are shared by the one open
                          // row; clearing them on open keeps a name typed for
                          // one child from appearing under the next.
                          setOtherName("");
                          // Pre-filled with the parent's own words, so the
                          // counselor does not retype them — and so the note
                          // that ends up on the record is what the family
                          // actually wrote. It is still an adult who saves it:
                          // a note is a one-off change, and the gate in
                          // src/lib/dismissal.ts has not moved.
                          setNote(c.parentSaid?.note ?? "");
                          setOpenId(c.participantId);
                        }
                      }}
                      className="shrink-0 rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white active:scale-95"
                    >
                      {open ? "סגירה" : "שחרור"}
                    </button>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                          state === "collected"
                            ? "bg-present/10 text-present"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {DISMISSAL_STATE_LABEL[state]}
                        {c.dismissal?.pickedUpByName
                          ? ` · ${c.dismissal.pickedUpByName}`
                          : ""}
                        {c.dismissal?.at ? ` · ${timeOf(c.dismissal.at)}` : ""}
                      </span>
                      {canAuthorize && (
                        <button
                          onClick={() => undo(c.participantId, c.name)}
                          disabled={busy}
                          className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-absent"
                        >
                          ביטול
                        </button>
                      )}
                    </span>
                  )}
                </div>

                {/* The standing instruction, always visible on the row. A child
                    with none is "מחכה למבוגר" — the column default — because
                    assuming the other way round is the mistake that matters. */}
                <p className="px-4 pb-2 text-xs text-slate-500">
                  הוראה קבועה: {DISMISSAL_METHOD_LABEL[c.defaultDismissal]}
                  {c.authorizations.length > 0 &&
                    ` · מורשים: ${c.authorizations
                      .map((a) => (a.relation ? `${a.name} (${a.relation})` : a.name))
                      .join(" · ")}`}
                  {c.authorizations.length === 0 &&
                    c.defaultDismissal === "escort" &&
                    " · אין מורשי איסוף ברשימה"}
                  {c.dismissal?.note ? ` · הערה: ${c.dismissal.note}` : ""}
                </p>

                {/* A parent's message, in its own box rather than appended to
                    the grey line above: at the gate this is the one sentence
                    that changes what happens next, and it must not read as
                    another detail among five. */}
                {c.parentSaid?.note && (
                  <p className="mx-4 mb-2 rounded-lg bg-late/10 px-3 py-2 text-xs text-late">
                    <span className="font-semibold">ההורה הודיע/ה: </span>
                    {c.parentSaid.note}
                  </p>
                )}

                {c.parentSaid?.coming === false && !c.dismissal && (
                  <p className="mx-4 mb-2 text-xs text-slate-500">
                    ההורה הודיע/ה שהילד/ה לא מגיע/ה היום.
                  </p>
                )}

                {rowError[c.participantId] && (
                  <p className="mx-4 mb-2 rounded-lg bg-late/10 px-3 py-2 text-xs font-semibold text-late">
                    {rowError[c.participantId]}
                  </p>
                )}

                {open && state === "waiting" && (
                  <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3">
                    {c.authorizations.length > 0 && (
                      <>
                        <span className="text-xs font-semibold text-slate-500">
                          מי אסף/ה?
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {c.authorizations.map((a) => (
                            <button
                              key={a.id}
                              disabled={busy}
                              onClick={() =>
                                mark(c.participantId, {
                                  method: "escort",
                                  pickedUpByName: a.name,
                                })
                              }
                              className="rounded-lg border border-present bg-white px-3 py-2 text-sm font-semibold text-present active:scale-95 disabled:opacity-50"
                            >
                              {a.name}
                              {a.relation ? ` · ${a.relation}` : ""}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    <button
                      disabled={busy}
                      onClick={() => mark(c.participantId, { method: "alone" })}
                      className={`w-fit rounded-lg border px-3 py-2 text-sm font-semibold active:scale-95 disabled:opacity-50 ${
                        aloneIsRoutine
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-600"
                      }`}
                    >
                      יצא/ה לבד
                      {!aloneIsRoutine && !canAuthorize && " (צריך בוגר/ת)"}
                    </button>

                    {/* Anyone not on the list, and any one-off change. A youth
                        counselor can type it and will be told an adult has to
                        confirm — better than a button that quietly does
                        nothing, and better than teaching them to pick a name
                        from the list that is not the person standing there. */}
                    <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
                      <span className="text-xs font-semibold text-slate-500">
                        מישהו אחר / שינוי חד-פעמי
                        {!canAuthorize && " — מחייב מדריך/ה בוגר/ת"}
                      </span>
                      <input
                        value={otherName}
                        onChange={(e) => setOtherName(e.target.value)}
                        placeholder="שם האוסף/ת"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
                      />
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="הערה (למשל: היום סבתא)"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
                      />
                      <button
                        disabled={busy || !otherName.trim()}
                        onClick={() =>
                          mark(c.participantId, {
                            method: "escort",
                            pickedUpByName: otherName.trim(),
                            note: note.trim() || undefined,
                          })
                        }
                        className="w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                      >
                        שחרור עם השם הזה
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
