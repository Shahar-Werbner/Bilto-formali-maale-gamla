"use client";

import { useEffect, useState } from "react";
import { todayDateOnly } from "@/lib/attendance";
import { formatHebrewDate } from "@/lib/events";
import {
  VERDICTS,
  VERDICT_ICON,
  VERDICT_LABEL,
  endTimeFrom,
  gradeRangeLabel,
  rateBlockReason,
  type Verdict,
} from "@/lib/activities";
import {
  SLOT_STATUS_LABEL,
  pendingCount,
  slotStatusOf,
  type SlotStatus,
} from "@/lib/schedule";

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
  /** "approved" | "pending" | "draft" — the approval loop, item 4. */
  status?: string;
  /** Item 7: the bank activity this slot was picked from, if any. */
  activityId?: string | null;
  activityName?: string | null;
  /** The signed-in person's own verdict on this run, if they gave one. */
  myVerdict?: string | null;
};

// What the slot routes answer with. They include the related rows rather than
// flat names; this is the one place that flattens them, so a freshly added
// slot shows its group tag and bank badge without a reload.
type ApiSlot = Omit<Slot, "groupName" | "activityName"> & {
  group?: { id: string; name: string } | null;
  activity?: { id: string; name: string } | null;
};

function toSlot(s: ApiSlot, prev?: Slot): Slot {
  return {
    id: s.id,
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.title,
    location: s.location,
    groupId: s.groupId,
    groupName: s.group?.name ?? null,
    notes: s.notes,
    order: s.order,
    status: s.status,
    activityId: s.activityId ?? null,
    activityName: s.activity?.name ?? null,
    // A write to the slot does not change anyone's rating of it.
    myVerdict: prev?.myVerdict ?? null,
  };
}

type BankItem = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  tags: string[];
  minGrade: string | null;
  maxGrade: string | null;
  summary: { worked: number; total: number };
};

type Draft = {
  startTime: string;
  endTime: string;
  title: string;
  location: string;
  groupId: string;
  notes: string;
  /** "" = not from the bank. */
  activityId: string;
  activityName: string;
};

const emptyDraft: Draft = {
  startTime: "",
  endTime: "",
  title: "",
  location: "",
  groupId: "",
  notes: "",
  activityId: "",
  activityName: "",
};

// The bank, searched from inside the slot form. Loaded once per day screen on
// first open, not with the page: most visits to a day never pick anything.
function BankPicker({
  load,
  onPick,
  onClose,
}: {
  load: () => Promise<BankItem[]>;
  onPick: (a: BankItem) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    load().then(setItems, () => setError(true));
    // Runs once per mount; `load` is cached by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needle = q.trim();
  const shown = (items ?? []).filter(
    (a) =>
      !needle ||
      a.name.includes(needle) ||
      a.tags.some((t) => t.includes(needle)) ||
      (a.description ?? "").includes(needle),
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-white p-2">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש במאגר (שם או תגית)"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          autoFocus
        />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
        >
          סגירה
        </button>
      </div>
      {error && <p className="text-sm text-red-700">טעינת המאגר נכשלה</p>}
      {!items && !error && <p className="text-sm text-slate-400">טוען…</p>}
      {items && shown.length === 0 && (
        <p className="text-sm text-slate-400">
          {items.length === 0 ? "המאגר עוד ריק." : "לא נמצאה פעילות מתאימה."}
        </p>
      )}
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {shown.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onPick(a)}
              className="w-full rounded-lg px-2 py-2 text-right hover:bg-emerald-50"
            >
              <span className="font-medium text-slate-900">{a.name}</span>
              <span className="block text-xs text-slate-500">
                {[
                  a.durationMinutes ? `${a.durationMinutes} דק'` : null,
                  gradeRangeLabel(a.minGrade, a.maxGrade),
                  a.tags.join(" · ") || null,
                  a.summary.total
                    ? `👍 ${a.summary.worked} מתוך ${a.summary.total}`
                    : "עוד לא דורגה",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SlotForm({
  groups,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  loadBank,
}: {
  groups: Group[];
  initial: Draft;
  submitLabel: string;
  onSubmit: (d: Draft) => void;
  onCancel?: () => void;
  /** Present when the person may read the bank (activity:view). */
  loadBank?: () => Promise<BankItem[]>;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [picking, setPicking] = useState(false);
  // The picked activity's length, while the end time is still the one derived
  // from it. Picking first and typing the start second is the natural order on
  // a phone, so the end time follows the start until someone types one.
  const [autoMinutes, setAutoMinutes] = useState<number | null>(null);

  // Picking fills what the bank knows and leaves what it does not: the time
  // the person already typed, the location, the group. The end time is only
  // derived when there is a start and no end yet — never overwritten.
  function pick(a: BankItem) {
    setAutoMinutes(d.endTime ? null : a.durationMinutes);
    setD((prev) => ({
      ...prev,
      title: a.name,
      notes: prev.notes || a.description || "",
      endTime: prev.endTime || endTimeFrom(prev.startTime, a.durationMinutes) || "",
      activityId: a.id,
      activityName: a.name,
    }));
    setPicking(false);
  }
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    if (k === "endTime") setAutoMinutes(null);
    setD((prev) =>
      k === "startTime" && autoMinutes
        ? { ...prev, startTime: value, endTime: endTimeFrom(value, autoMinutes) ?? "" }
        : { ...prev, [k]: value },
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!d.startTime || !d.title.trim()) return;
        onSubmit(d);
      }}
      className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3"
    >
      {loadBank &&
        (picking ? (
          <BankPicker load={loadBank} onPick={pick} onClose={() => setPicking(false)} />
        ) : d.activityId ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <span className="min-w-0 truncate">📚 מהמאגר: {d.activityName || d.title}</span>
            <button
              type="button"
              onClick={() => setD((p) => ({ ...p, activityId: "", activityName: "" }))}
              className="shrink-0 text-xs text-emerald-700 underline"
            >
              ניתוק מהמאגר
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="rounded-lg border border-emerald-300 bg-white py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            📚 בחירה ממאגר הפעילויות
          </button>
        ))}
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
  canEdit = true,
  canPropose = false,
  canApprove = false,
  dayDate = "",
  canUseBank = false,
  canEditBank = false,
  canRate = false,
}: {
  eventDayId: string;
  initialSlots: Slot[];
  groups: Group[];
  /** "YYYY-MM-DD" — decides whether this day's activities can be rated yet. */
  dayDate?: string;
  /** activity:view — pick from the bank. */
  canUseBank?: boolean;
  /** activity:edit — save a typed-in slot to the bank. */
  canEditBank?: boolean;
  /** activity:rate — "how did it go?" after it ran. */
  canRate?: boolean;
  /** schedule:edit — writes straight into the day. */
  canEdit?: boolean;
  /** schedule:propose — a youth counselor plans the activity they run; the
   *  slot lands as "ממתין לאישור" and an adult signs it off. They may also fix
   *  a slot that is not approved yet, and nothing else. */
  canPropose?: boolean;
  /** schedule:approve — the adult end of that loop. */
  canApprove?: boolean;
}) {
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Item 7 — the bank, loaded on first use and shared by every form on the day.
  const [bankCache, setBankCache] = useState<Promise<BankItem[]> | null>(null);
  const loadBank = canUseBank
    ? () => {
        if (bankCache) return bankCache;
        const p = fetch("/api/activities").then((r) => {
          if (!r.ok) throw new Error();
          return r.json() as Promise<BankItem[]>;
        });
        // A failed load is not cached, so reopening the picker retries.
        p.catch(() => setBankCache(null));
        setBankCache(p);
        return p;
      }
    : undefined;

  // The note that can follow a verdict, for the slot just rated.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  // Copy another day's schedule — the template (item 7).
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDays, setCopyDays] = useState<
    { id: string; date: string; eventName: string; slots: { startTime: string; title: string }[] }[] | null
  >(null);
  const [copyBusy, setCopyBusy] = useState(false);

  // AI import
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () =>
        resolve(String(r.result).replace(/^data:.*;base64,/, ""));
      r.onerror = () => reject(new Error("קריאת הקובץ נכשלה"));
      r.readAsDataURL(file);
    });
  }

  async function runAi(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let text = aiText;
    let pdfBase64: string | undefined;

    if (aiFile) {
      if (aiFile.type === "application/pdf") {
        pdfBase64 = await readAsBase64(aiFile).catch(() => undefined);
      } else {
        // text-like file → read as plain text and append
        const fileText = await aiFile.text().catch(() => "");
        text = [text, fileText].filter(Boolean).join("\n");
      }
    }

    if (!text.trim() && !pdfBase64) {
      setError("כתוב תיאור או בחר קובץ");
      return;
    }

    setAiBusy(true);
    try {
      const res = await fetch(
        `/api/event-days/${eventDayId}/activity-slots/ai`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, pdfBase64 }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "עיבוד ה-AI נכשל");
      }
      const { created } = await res.json();
      const added: Slot[] = (created ?? []).map((x: ApiSlot) => toSlot(x));
      setSlots((cur) => [...cur, ...added]);
      setAiText("");
      setAiFile(null);
      setAiOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  async function addSlot(d: Draft) {
    setError(null);
    try {
      const res = await fetch(`/api/event-days/${eventDayId}/activity-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      if (!res.ok) throw new Error();
      const slot = toSlot(await res.json());
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
      const json: ApiSlot = await res.json();
      setSlots((s) => s.map((x) => (x.id === id ? toSlot(json, x) : x)));
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

  async function decide(id: string, approve: boolean) {
    setError(null);
    const prev = slots;
    try {
      const res = await fetch(`/api/activity-slots/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      });
      if (!res.ok) throw new Error();
      const json: ApiSlot = await res.json();
      setSlots((s) => s.map((x) => (x.id === id ? toSlot(json, x) : x)));
    } catch {
      setSlots(prev);
      setError(approve ? "האישור נכשל" : "ההחזרה לתיקון נכשלה");
    }
  }

  // The verdict lands only when the server confirms it — a rating that shows
  // as given and silently was not is the loop failing without anyone knowing.
  async function rate(id: string, verdict: Verdict, note?: string) {
    setError(null);
    try {
      const res = await fetch(`/api/activity-slots/${id}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? { verdict, note } : { verdict }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "הדירוג נכשל");
      }
      setSlots((s) => s.map((x) => (x.id === id ? { ...x, myVerdict: verdict } : x)));
      if (note) {
        setNoteFor(null);
        setNoteText("");
      } else {
        setNoteFor(id);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveToBank(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/activity-slots/${id}/to-bank`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "השמירה במאגר נכשלה");
      }
      const { activityId, activityName } = await res.json();
      setSlots((s) => s.map((x) => (x.id === id ? { ...x, activityId, activityName } : x)));
      setBankCache(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openCopy() {
    setCopyOpen(true);
    setCopyDays(null);
    try {
      const res = await fetch(`/api/event-days/${eventDayId}/activity-slots/copy`);
      if (!res.ok) throw new Error();
      setCopyDays(await res.json());
    } catch {
      setCopyOpen(false);
      setError("טעינת הימים הקודמים נכשלה");
    }
  }

  async function copyFrom(fromDayId: string) {
    if (
      slots.length > 0 &&
      !confirm("ביום הזה כבר יש פעילויות. להוסיף אחריהן את הלוז של היום שנבחר?")
    ) {
      return;
    }
    setError(null);
    setCopyBusy(true);
    try {
      const res = await fetch(`/api/event-days/${eventDayId}/activity-slots/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDayId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "ההעתקה נכשלה");
      }
      const { created } = await res.json();
      setSlots((cur) => [...cur, ...(created as ApiSlot[]).map((x) => toSlot(x))]);
      setCopyOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCopyBusy(false);
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

  // Reordering is a change to the live day, so it stays with schedule:edit.
  const canWrite = canEdit || canPropose;
  // A proposer may fix what is not part of the day yet — their own plan, or one
  // sent back for a fix — and may not touch an approved slot. Same rule as the
  // route enforces (src/lib/schedule.ts); the button just stops offering what
  // would come back 403.
  const mayChange = (slot: Slot) =>
    canEdit || (canPropose && slotStatusOf(slot.status) !== "approved");
  const waiting = pendingCount(slots);
  const today = todayDateOnly();
  const rateable = (slot: Slot) =>
    canRate &&
    !!dayDate &&
    rateBlockReason({ activityId: slot.activityId, status: slot.status, date: dayDate, today }) ===
      null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">לוז היום</h2>
        {waiting > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            {canApprove
              ? `${waiting} ממתינות לאישור שלך`
              : `${waiting} ממתינות לאישור`}
          </span>
        )}
      </div>

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
          mayChange(slot) && editingId === slot.id ? (
            <li key={slot.id}>
              <SlotForm
                groups={groups}
                submitLabel={canEdit ? "שמירה" : "שליחה לאישור"}
                onCancel={() => setEditingId(null)}
                onSubmit={(d) => saveSlot(slot.id, d)}
                initial={{
                  startTime: slot.startTime,
                  endTime: slot.endTime ?? "",
                  title: slot.title,
                  location: slot.location ?? "",
                  groupId: slot.groupId ?? "",
                  notes: slot.notes ?? "",
                  activityId: slot.activityId ?? "",
                  activityName: slot.activityName ?? "",
                }}
                loadBank={loadBank}
              />
            </li>
          ) : (
            <li
              key={slot.id}
              className={`flex flex-wrap items-start gap-2 rounded-xl border p-3 ${
                slotStatusOf(slot.status) === "approved"
                  ? "border-slate-200"
                  : "border-amber-300 bg-amber-50/50"
              }`}
            >
              {canEdit && (
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
              )}
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
                  <StatusBadge status={slotStatusOf(slot.status)} />
                  {slot.activityId && (
                    <span
                      title={slot.activityName ? `מהמאגר: ${slot.activityName}` : "מהמאגר"}
                      className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                    >
                      📚 מהמאגר
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
              <div className="flex shrink-0 flex-col items-end gap-1">
                {canApprove && slotStatusOf(slot.status) !== "approved" && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => decide(slot.id, true)}
                      className="rounded-lg bg-present/10 px-2 py-1 text-sm font-semibold text-present hover:bg-present/20"
                    >
                      אישור
                    </button>
                    {slotStatusOf(slot.status) === "pending" && (
                      <button
                        onClick={() => decide(slot.id, false)}
                        className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
                      >
                        החזרה לתיקון
                      </button>
                    )}
                  </div>
                )}
                {mayChange(slot) && (
                  <div className="flex gap-1">
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
                )}
              </div>
              {/* Full width under the row: on a phone the content column is
                  squeezed by the action buttons, and three verdict buttons in
                  it stacked into three lines per slot. */}
              <div className="w-full empty:hidden">
                {rateable(slot) && (
                  <RatingStrip
                    verdict={slot.myVerdict ?? null}
                    onRate={(v) => rate(slot.id, v)}
                  />
                )}
                {noteFor === slot.id && slot.myVerdict && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (noteText.trim()) rate(slot.id, slot.myVerdict as Verdict, noteText.trim());
                    }}
                    className="mt-2 flex gap-2"
                  >
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="משפט לבא/ה אחריך (לא חובה)"
                      maxLength={300}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-base"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      שמירה
                    </button>
                  </form>
                )}
                {canEditBank &&
                  !slot.activityId &&
                  slotStatusOf(slot.status) === "approved" && (
                    <button
                      onClick={() => saveToBank(slot.id)}
                      className="mt-1 text-xs font-semibold text-emerald-700 hover:underline"
                    >
                      📚 שמירה במאגר
                    </button>
                  )}
              </div>
            </li>
          ),
        )}
      </ul>

      <div className="mt-3">
        {!canWrite ? null : adding ? (
          <SlotForm
            groups={groups}
            initial={emptyDraft}
            submitLabel={canEdit ? "הוספה" : "שליחה לאישור"}
            onCancel={() => setAdding(false)}
            onSubmit={addSlot}
            loadBank={loadBank}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {canEdit ? "+ הוספת פעילות ללוז" : "+ הצעת פעילות ללוז"}
          </button>
        )}
        {/* A youth counselor is told what the button does before they press
            it. The alternative the role had until now was a button that came
            back 403, which reads as "the app is broken", not as "an adult has
            to approve this". */}
        {canWrite && !canEdit && (
          <p className="mt-1 text-xs text-slate-400">
            הפעילות תישלח לאישור של בוגר/ת ותיכנס ללוז אחרי שתאושר.
          </p>
        )}
      </div>

      {/* Template: last Tuesday, again (item 7). */}
      {canEdit && (
        <div className="mt-2">
          {copyOpen ? (
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">
                  מאיזה יום להעתיק את הלוז?
                </span>
                <button
                  onClick={() => setCopyOpen(false)}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
                >
                  סגירה
                </button>
              </div>
              {!copyDays && <p className="text-sm text-slate-400">טוען…</p>}
              {copyDays && copyDays.length === 0 && (
                <p className="text-sm text-slate-400">עוד אין ימים עם לוז להעתיק מהם.</p>
              )}
              <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                {copyDays?.map((d) => (
                  <li key={d.id}>
                    <button
                      disabled={copyBusy}
                      onClick={() => copyFrom(d.id)}
                      className="w-full rounded-lg bg-white px-3 py-2 text-right hover:bg-slate-100 disabled:opacity-60"
                    >
                      <span className="font-medium text-slate-900">
                        {formatHebrewDate(d.date)}
                      </span>
                      <span className="text-sm text-slate-500"> · {d.eventName}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {d.slots.length} פעילויות: {d.slots.map((x) => x.title).join(", ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <button
              onClick={openCopy}
              className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              📋 העתקת לוז מיום קודם
            </button>
          )}
        </div>
      )}

      {/* AI import */}
      <div className="mt-2">
        {aiOpen ? (
          <form
            onSubmit={runAi}
            className="flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3"
          >
            <span className="text-sm font-semibold text-indigo-900">
              ✨ סידור אוטומטי עם AI
            </span>
            <textarea
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="כתוב בחופשי, למשל: 9:00 ארוחת בוקר, 10 ריקוד לקבוצה א' באולם, 12 צהריים…"
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
            <label className="text-xs text-slate-500">
              או צרף קובץ תכנון (טקסט או PDF):
              <input
                type="file"
                accept=".txt,.md,.csv,text/plain,application/pdf"
                onChange={(e) => setAiFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={aiBusy}
                className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {aiBusy ? "מסדר…" : "סדר ללוז"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAiOpen(false);
                  setAiText("");
                  setAiFile(null);
                }}
                className="rounded-lg px-4 py-2 font-medium text-slate-500 hover:bg-slate-100"
              >
                ביטול
              </button>
            </div>
            <p className="text-xs text-slate-400">
              ה-AI ימיר את התיאור לפעילויות מסודרות. אפשר לערוך אחר כך.
            </p>
          </form>
        ) : canEdit ? (
          <button
            onClick={() => setAiOpen(true)}
            className="w-full rounded-lg border border-dashed border-indigo-300 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            ✨ סידור אוטומטי עם AI
          </button>
        ) : null}
      </div>
    </section>
  );
}

// "How did it go?" — three taps, no form. This is what turns the bank from a
// list into a ranking, so it has to cost less than ignoring it: it sits on the
// slot itself, on the day it ran, and a second tap changes the answer.
function RatingStrip({
  verdict,
  onRate,
}: {
  verdict: string | null;
  onRate: (v: Verdict) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <span className="text-xs text-slate-500">איך היה?</span>
      {VERDICTS.map((v) => (
        <button
          key={v}
          onClick={() => onRate(v)}
          aria-pressed={verdict === v}
          aria-label={VERDICT_LABEL[v]}
          className={`rounded-full border px-2 py-1 text-xs font-semibold ${
            verdict === v
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {VERDICT_ICON[v]} {v === "wrong_age" ? "לא לגיל" : VERDICT_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

// An approved slot is the normal state and carries no badge — a screen where
// every line is decorated says nothing. Only what is not yet part of the day
// is marked.
function StatusBadge({ status }: { status: SlotStatus }) {
  if (status === "approved") return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        status === "pending"
          ? "bg-amber-200 text-amber-900"
          : "bg-slate-200 text-slate-600"
      }`}
    >
      {SLOT_STATUS_LABEL[status]}
    </span>
  );
}
