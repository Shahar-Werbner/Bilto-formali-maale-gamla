"use client";

import { useState } from "react";
import { formatHebrewDate, formatTimeRange } from "@/lib/events";
import { PARENT_NOTE_MAX } from "@/lib/parents";
import type { ParentDay } from "@/lib/parent-link";

// What a parent sees and taps. The audience is the whole of the operation's
// parent body on their own phones, once a week, with no training and no
// support desk — so the screen asks one question per session, in two buttons,
// and says out loud what it saved.

type SaveState = "idle" | "saving" | "saved" | "error";

type DayState = ParentDay & {
  save: SaveState;
  error: string | null;
  /** The note being typed, which is not the note the server has yet. */
  draftNote: string;
};

export default function ParentAnswerForm({
  token,
  days,
}: {
  token: string;
  days: ParentDay[];
}) {
  const [rows, setRows] = useState<DayState[]>(
    days.map((d) => ({ ...d, save: "idle", error: null, draftNote: d.note ?? "" })),
  );

  function patch(id: string, next: Partial<DayState>) {
    setRows((current) =>
      current.map((r) => (r.id === id ? { ...r, ...next } : r)),
    );
  }

  // The same rule the staff side follows for attendance (CLAUDE.md): the answer
  // on screen changes only once the server has confirmed it. An optimistic tap
  // that silently rolls back is the bug that lost work in the field, and here
  // it would be worse than lost work — a parent would believe they had told us
  // their child is not coming today.
  async function save(row: DayState, coming: boolean, note: string) {
    patch(row.id, { save: "saving", error: null });
    try {
      const res = await fetch(`/api/parent/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventDayId: row.id,
          coming,
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        patch(row.id, {
          save: "error",
          error: data?.error ?? "לא הצלחנו לשמור. אפשר לנסות שוב.",
        });
        return;
      }
      patch(row.id, {
        save: "saved",
        error: null,
        coming: data.coming,
        note: data.note ?? null,
        draftNote: data.note ?? "",
      });
    } catch {
      patch(row.id, {
        save: "error",
        error: "אין חיבור כרגע. אפשר לנסות שוב בעוד רגע.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const hours = formatTimeRange(row.startTime, row.endTime);
        const answered = row.coming !== null;
        return (
          <section
            key={row.id}
            className="rounded-2xl bg-white p-4 shadow-sm"
            aria-label={formatHebrewDate(row.date)}
          >
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <span className="text-base font-semibold text-slate-900">
                {formatHebrewDate(row.date)}
              </span>
              <span className="text-xs text-slate-500">
                {hours ? `${row.eventName} · ${hours}` : row.eventName}
              </span>
            </div>

            {/* Two buttons rather than a toggle: a toggle needs you to know
                which way is "yes", and this is read at 07:00 by someone
                getting three children out of the house. */}
            <div className="grid grid-cols-2 gap-2">
              <AnswerButton
                selected={row.coming === true}
                busy={row.save === "saving"}
                tone="yes"
                onClick={() => save(row, true, row.draftNote)}
              >
                מגיע/ה
              </AnswerButton>
              <AnswerButton
                selected={row.coming === false}
                busy={row.save === "saving"}
                tone="no"
                onClick={() => save(row, false, row.draftNote)}
              >
                לא מגיע/ה
              </AnswerButton>
            </div>

            <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-slate-600">
              הודעה לצוות (למשל: היום סבתא אוספת)
              <textarea
                value={row.draftNote}
                maxLength={PARENT_NOTE_MAX}
                rows={2}
                onChange={(e) => patch(row.id, { draftNote: e.target.value })}
                onBlur={() => {
                  // A note on its own is not an answer — there is nothing to
                  // save it against until the parent has said yes or no.
                  if (row.coming === null) return;
                  if ((row.note ?? "") === row.draftNote.trim()) return;
                  void save(row, row.coming, row.draftNote);
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                placeholder={
                  answered ? "" : "אפשר לכתוב אחרי שבוחרים מגיע/ה או לא"
                }
              />
            </label>

            <p className="mt-2 min-h-[1.25rem] text-xs" aria-live="polite">
              {row.save === "saving" && (
                <span className="text-slate-400">שומר…</span>
              )}
              {row.save === "saved" && (
                <span className="text-emerald-600">נשמר. תודה!</span>
              )}
              {row.save === "error" && (
                <span className="text-red-600">{row.error}</span>
              )}
              {row.save === "idle" && answered && (
                <span className="text-slate-400">
                  {row.coming ? "רשום שמגיע/ה" : "רשום שלא מגיע/ה"}
                </span>
              )}
            </p>
          </section>
        );
      })}
    </div>
  );
}

function AnswerButton({
  selected,
  busy,
  tone,
  onClick,
  children,
}: {
  selected: boolean;
  busy: boolean;
  tone: "yes" | "no";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base =
    // min-h-12 rather than padding alone: these are the only two targets on
    // the screen and they are tapped with a thumb, one-handed.
    "min-h-12 rounded-xl border px-3 py-3 text-base font-semibold transition disabled:opacity-60";
  const chosen =
    tone === "yes"
      ? "border-emerald-600 bg-emerald-600 text-white"
      : "border-slate-500 bg-slate-600 text-white";
  const unchosen = "border-slate-300 bg-white text-slate-700";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={selected}
      className={`${base} ${selected ? chosen : unchosen}`}
    >
      {children}
    </button>
  );
}
