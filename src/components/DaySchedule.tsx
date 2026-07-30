"use client";

import { useState } from "react";

type Group = { id: string; name: string };
export type Slot = {
  id: string;
  startTime: string;
  endTime: string | null;
  title: string;
  location: string | null;
  groupId: string | null;
  groupName: string | null;
  notes: string | null;
  order: number;
};

type Draft = {
  startTime: string;
  endTime: string;
  title: string;
  location: string;
  groupId: string;
  notes: string;
};

const emptyDraft: Draft = {
  startTime: "",
  endTime: "",
  title: "",
  location: "",
  groupId: "",
  notes: "",
};

function SlotForm({
  groups,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  groups: Group[];
  initial: Draft;
  submitLabel: string;
  onSubmit: (d: Draft) => void;
  onCancel?: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!d.startTime || !d.title.trim()) return;
        onSubmit(d);
      }}
      className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3"
    >
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col text-xs text-slate-500">
          משעה
          <input
            type="time"
            value={d.startTime}
            onChange={set("startTime")}
            required
            className="rounded-lg border border-slate-300 px-2 py-2 text-base"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col text-xs text-slate-500">
          עד שעה
          <input
            type="time"
            value={d.endTime}
            onChange={set("endTime")}
            className="rounded-lg border border-slate-300 px-2 py-2 text-base"
          />
        </label>
      </div>
      <input
        value={d.title}
        onChange={set("title")}
        placeholder="פעילות (למשל: ארוחת בוקר)"
        required
        className="rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <div className="flex gap-2">
        <input
          value={d.location}
          onChange={set("location")}
          placeholder="מיקום"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <select
          value={d.groupId}
          onChange={set("groupId")}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-base"
        >
          <option value="">כל האירוע</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <input
        value={d.notes}
        onChange={set("notes")}
        placeholder="הערות (אופציונלי)"
        className="rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 font-medium text-slate-500 hover:bg-slate-100"
          >
            ביטול
          </button>
        )}
      </div>
    </form>
  );
}

export default function DaySchedule({
  eventDayId,
  initialSlots,
  groups,
}: {
  eventDayId: string;
  initialSlots: Slot[];
  groups: Group[];
}) {
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addSlot(d: Draft) {
    setError(null);
    try {
      const res = await fetch(`/api/event-days/${eventDayId}/activity-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      if (!res.ok) throw new Error();
      const slot: Slot = await res.json();
      setSlots((s) => [...s, slot]);
      setAdding(false);
    } catch {
      setError("הוספת הפעילות נכשלה");
    }
  }

  async function saveSlot(id: string, d: Draft) {
    setError(null);
    const prev = slots;
    try {
      const res = await fetch(`/api/activity-slots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      if (!res.ok) throw new Error();
      const slot: Slot = await res.json();
      setSlots((s) => s.map((x) => (x.id === id ? slot : x)));
      setEditingId(null);
    } catch {
      setSlots(prev);
      setError("שמירת הפעילות נכשלה");
    }
  }

  async function deleteSlot(id: string) {
    if (!confirm("למחוק את הפעילות?")) return;
    const prev = slots;
    setSlots((s) => s.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/activity-slots/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setSlots(prev);
      setError("מחיקת הפעילות נכשלה");
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= slots.length) return;
    const arr = [...slots];
    [arr[index], arr[j]] = [arr[j], arr[index]];
    const prev = slots;
    setSlots(arr);
    try {
      const res = await fetch(
        `/api/event-days/${eventDayId}/activity-slots/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds: arr.map((s) => s.id) }),
        },
      );
      if (!res.ok) throw new Error();
    } catch {
      setSlots(prev);
      setError("שינוי הסדר נכשל");
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-base font-bold text-slate-900">לוז היום</h2>

      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {slots.length === 0 && !adding && (
        <p className="mb-3 text-sm text-slate-400">
          אין עדיין פעילויות ליום זה.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {slots.map((slot, i) =>
          editingId === slot.id ? (
            <li key={slot.id}>
              <SlotForm
                groups={groups}
                submitLabel="שמירה"
                onCancel={() => setEditingId(null)}
                onSubmit={(d) => saveSlot(slot.id, d)}
                initial={{
                  startTime: slot.startTime,
                  endTime: slot.endTime ?? "",
                  title: slot.title,
                  location: slot.location ?? "",
                  groupId: slot.groupId ?? "",
                  notes: slot.notes ?? "",
                }}
              />
            </li>
          ) : (
            <li
              key={slot.id}
              className="flex items-start gap-2 rounded-xl border border-slate-200 p-3"
            >
              <div className="flex flex-col pt-0.5">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="למעלה"
                  className="px-1 text-xs leading-none text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === slots.length - 1}
                  aria-label="למטה"
                  className="px-1 text-xs leading-none text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  ▼
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-700" dir="ltr">
                    {slot.startTime}
                    {slot.endTime ? `–${slot.endTime}` : ""}
                  </span>
                  <span className="font-medium text-slate-900">{slot.title}</span>
                  {slot.groupName && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {slot.groupName}
                    </span>
                  )}
                </div>
                {(slot.location || slot.notes) && (
                  <div className="mt-0.5 text-sm text-slate-500">
                    {slot.location && <span>📍 {slot.location}</span>}
                    {slot.location && slot.notes && <span> · </span>}
                    {slot.notes && <span>{slot.notes}</span>}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => setEditingId(slot.id)}
                  className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
                >
                  עריכה
                </button>
                <button
                  onClick={() => deleteSlot(slot.id)}
                  className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-red-50 hover:text-absent"
                >
                  מחיקה
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      <div className="mt-3">
        {adding ? (
          <SlotForm
            groups={groups}
            initial={emptyDraft}
            submitLabel="הוספה"
            onCancel={() => setAdding(false)}
            onSubmit={addSlot}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            + הוספת פעילות ללוז
          </button>
        )}
      </div>
    </section>
  );
}
