"use client";

import { useState } from "react";
import type { Participant } from "./RosterManager";

// One child in the master list. Collapsed it shows name and grade; expanded it
// shows the contact details, with the phone as a tel: link — on a trip the
// point is to reach a parent in one tap, not to read a number off a screen.
export default function ParticipantRow({
  participant,
  striped,
  isAdmin,
  canEdit = true,
  canSeeContacts = true,
  duplicateOf,
  onUpdate,
  onDelete,
  onMerge,
}: {
  participant: Participant;
  striped: boolean;
  isAdmin: boolean;
  /** roster:edit — without it the row is read-only. */
  canEdit?: boolean;
  /** roster:contacts — without it there are no contacts on the row to show. */
  canSeeContacts?: boolean;
  /** The other child sharing this name, if there is one. */
  duplicateOf?: Participant;
  onUpdate: (id: string, patch: Partial<Participant>) => void;
  onDelete: (id: string) => void;
  onMerge: (keepId: string, mergeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const p = participant;

  const field = (
    key: "name" | "grade" | "parentName" | "parentPhone" | "phone",
    value: string,
  ) => {
    const current = p[key] ?? "";
    if ((value.trim() || null) !== (current || null)) {
      onUpdate(p.id, { [key]: value.trim() } as Partial<Participant>);
    }
  };

  return (
    <li
      className={`border-b border-slate-200 last:border-b-0 ${
        striped ? "bg-slate-50" : "bg-white"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {canSeeContacts ? (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "סגירת פרטים" : "פתיחת פרטים"}
            className="shrink-0 px-1 text-xs text-slate-400 hover:text-slate-700"
          >
            {open ? "▲" : "▼"}
          </button>
        ) : (
          <span className="shrink-0 px-1 text-xs text-transparent">▾</span>
        )}

        {/* The name carries a visible border like the grade field beside it:
            there is no hover on a phone, so an edit-on-hover affordance would
            be invisible to the people actually using this. */}
        {canEdit ? (
          <input
            defaultValue={p.name}
            onBlur={(e) => {
              if (!e.target.value.trim()) {
                e.target.value = p.name; // an empty name is not an edit
                return;
              }
              field("name", e.target.value);
            }}
            aria-label={`שם: ${p.name}`}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 font-medium text-slate-800 focus:border-slate-400 focus:outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 px-2 py-1 font-medium text-slate-800">
            {p.name}
          </span>
        )}

        {p.parentPhone && (
          <a
            href={`tel:${p.parentPhone}`}
            aria-label={`התקשרות להורה של ${p.name}`}
            className="shrink-0 rounded-lg px-2 py-1.5 text-base leading-none hover:bg-slate-200"
          >
            📞
          </a>
        )}

        {canEdit ? (
          <input
            defaultValue={p.grade ?? ""}
            onBlur={(e) => field("grade", e.target.value)}
            placeholder="כיתה"
            aria-label={`כיתה של ${p.name}`}
            className="w-16 shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm"
          />
        ) : (
          p.grade && (
            <span className="w-16 shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-center text-xs text-slate-600">
              {p.grade}
            </span>
          )
        )}

        {isAdmin && (
          <button
            onClick={() => onDelete(p.id)}
            className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:bg-red-50 hover:text-absent"
            aria-label={`מחיקת ${p.name}`}
          >
            מחיקה
          </button>
        )}
      </div>

      {duplicateOf && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-late/10 px-3 py-2 text-xs text-late">
          <span>קיים/ת עוד ילד/ה בשם הזה.</span>
          {isAdmin ? (
            <button
              onClick={() => {
                if (
                  confirm(
                    `למזג את שתי הרשומות של "${p.name}"? הנוכחות והקבוצות יעברו לרשומה שנשארת.`,
                  )
                )
                  onMerge(p.id, duplicateOf.id);
              }}
              className="rounded-md border border-late/40 px-2 py-1 font-semibold hover:bg-late/20"
            >
              מיזוג לרשומה הזו
            </button>
          ) : (
            <span>מנהל/ת יכול/ה למזג.</span>
          )}
        </div>
      )}

      {open && canSeeContacts && (
        <div className="grid gap-2 px-3 pb-3 pr-10 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            שם הורה
            <input
              defaultValue={p.parentName ?? ""}
              onBlur={(e) => field("parentName", e.target.value)}
              readOnly={!canEdit}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            טלפון הורה
            <input
              defaultValue={p.parentPhone ?? ""}
              onBlur={(e) => field("parentPhone", e.target.value)}
              readOnly={!canEdit}
              type="tel"
              dir="ltr"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            טלפון של הילד/ה
            <input
              defaultValue={p.phone ?? ""}
              onBlur={(e) => field("phone", e.target.value)}
              readOnly={!canEdit}
              type="tel"
              dir="ltr"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      )}
    </li>
  );
}
