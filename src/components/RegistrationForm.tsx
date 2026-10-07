"use client";

import { useMemo, useState } from "react";
import { formatHebrewDate, formatTimeRange } from "@/lib/events";
import { gradeRank } from "@/lib/attendance";
import { MAX_CHILDREN_PER_SUBMISSION, NOTE_MAX } from "@/lib/registration";

// The registration form a parent fills in on their phone (item 8). The
// audience is every parent in the WhatsApp group, the evening before, with no
// training — so every question is a pair of big buttons or one short field,
// and the screen after sending says plainly what was sent.
//
// Nothing saved about a child is shown here, and picking a child from the list
// fills in nothing: the link is shared by the whole group, and pre-filling the
// stored phone would hand every parent's number to anyone holding the link.

export type PublicFormDay = {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  equipment: string[];
};

export type PublicForm = {
  eventName: string;
  intro: string | null;
  price: string | null;
  closesAt: string | null;
  equipment: string[];
  equipmentUpdated: boolean;
  days: PublicFormDay[];
};

type RosterChild = { id: string; name: string; grade: string | null };

type DayChoice = { coming: boolean | null; bringsFood: boolean | null };

type Entry = {
  key: number;
  pick: string; // participant id, "new", or "" (not chosen)
  newName: string;
  newGrade: string;
  parentName: string;
  parentPhone: string;
  dismissal: "" | "alone" | "escort";
  pickupName: string;
  pickupRelation: string;
  pickupPhone: string;
  days: Record<string, DayChoice>;
  note: string;
};

type Result = { name: string; outcome: "received" | "waitlist" };

const NEW = "new";

// text-base, not text-sm: below 16px iOS zooms the page on focus, and the
// parent then fills the rest of the form sideways.
const INPUT =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-slate-500 focus:outline-none";

function emptyEntry(key: number, days: PublicFormDay[]): Entry {
  return {
    key,
    pick: "",
    newName: "",
    newGrade: "",
    parentName: "",
    parentPhone: "",
    dismissal: "",
    pickupName: "",
    pickupRelation: "",
    pickupPhone: "",
    days: Object.fromEntries(days.map((d) => [d.id, { coming: null, bringsFood: null }])),
    note: "",
  };
}

function closesLabel(local: string): string {
  const [date, time] = local.split("T");
  return `${formatHebrewDate(date)} בשעה ${time}`;
}

export default function RegistrationForm({
  token,
  form,
  roster,
  full,
}: {
  token: string;
  form: PublicForm;
  roster: RosterChild[];
  full: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>([emptyEntry(1, form.days)]);
  const [equipmentAck, setEquipmentAck] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ results: Result[]; entries: Entry[] } | null>(null);

  const hasEquipment =
    form.equipment.length > 0 || form.days.some((d) => d.equipment.length > 0);

  // The list grouped by grade, so a parent scrolls to "ב׳" rather than through
  // fifty names. Sorted by grade already (invariant 6); grouped here.
  const byGrade = useMemo(() => {
    const groups: { grade: string; children: RosterChild[] }[] = [];
    for (const c of roster) {
      const g = c.grade || "בלי כיתה";
      const last = groups[groups.length - 1];
      if (last && last.grade === g) last.children.push(c);
      else groups.push({ grade: g, children: [c] });
    }
    return groups.sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade));
  }, [roster]);

  const nameOf = (id: string) => roster.find((c) => c.id === id)?.name ?? "";

  function patch(key: number, next: Partial<Entry>) {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...next } : e)));
  }

  function patchDay(key: number, dayId: string, next: Partial<DayChoice>) {
    setEntries((list) =>
      list.map((e) =>
        e.key === key ? { ...e, days: { ...e.days, [dayId]: { ...e.days[dayId], ...next } } } : e,
      ),
    );
  }

  // A sibling starts as a full copy of the child above — every field, so a
  // family types the phone and the pickup once — except who the child is.
  function addSibling() {
    setEntries((list) => {
      const prev = list[list.length - 1];
      const key = Math.max(...list.map((e) => e.key)) + 1;
      return [...list, { ...prev, key, pick: "", newName: "", newGrade: "", days: { ...prev.days } }];
    });
  }

  async function submit() {
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/registration/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          children: entries.map((e) => ({
            participantId: e.pick && e.pick !== NEW ? e.pick : undefined,
            newChild: e.pick === NEW ? { name: e.newName, grade: e.newGrade } : undefined,
            parentName: e.parentName,
            parentPhone: e.parentPhone,
            dismissal: e.dismissal || undefined,
            pickup:
              e.dismissal === "escort"
                ? { name: e.pickupName, relation: e.pickupRelation, phone: e.pickupPhone }
                : undefined,
            days: form.days
              .filter((d) => e.days[d.id]?.coming !== null)
              .map((d) => ({
                eventDayId: d.id,
                coming: e.days[d.id].coming,
                bringsFood: e.days[d.id].coming ? e.days[d.id].bringsFood : null,
              })),
            note: e.note,
            equipmentAck,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          data?.closed
            ? "ההרשמה נסגרה בינתיים, וההרשמה לא נשמרה."
            : (data?.error ?? "לא הצלחנו לשלוח. אפשר לנסות שוב."),
        );
        return;
      }
      setSent({ results: data.results, entries });
      window.scrollTo({ top: 0 });
    } catch {
      setError("אין חיבור כרגע. ההרשמה לא נשלחה — אפשר לנסות שוב בעוד רגע.");
    } finally {
      setSending(false);
    }
  }

  const header = (
    <header className="mb-4 mt-6">
      <h1 className="text-center text-2xl font-bold text-slate-900">
        הרשמה: {form.eventName}
      </h1>
      <ul className="mt-3 flex flex-col gap-1 rounded-2xl bg-white p-4 text-sm text-slate-700 shadow-sm">
        {form.days.map((d) => (
          <li key={d.id} className="flex justify-between gap-2">
            <span className="font-medium">{formatHebrewDate(d.date)}</span>
            <span dir="ltr" className="text-slate-500">
              {formatTimeRange(d.startTime, d.endTime)}
            </span>
          </li>
        ))}
      </ul>
      {form.intro && (
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
          {form.intro}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        {form.price && <span>מחיר: {form.price}</span>}
        {form.closesAt && <span>ההרשמה נסגרת: {closesLabel(form.closesAt)}</span>}
      </div>
    </header>
  );

  const equipmentBox = hasEquipment && (
    <section className="rounded-2xl bg-amber-50 p-4 text-sm text-slate-800 shadow-sm">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        מה להביא
        {form.equipmentUpdated && (
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-900">
            עודכן
          </span>
        )}
      </h2>
      {form.equipment.length > 0 && (
        <p>{form.equipment.join(" · ")}</p>
      )}
      {form.days
        .filter((d) => d.equipment.length > 0)
        .map((d) => (
          <p key={d.id} className="mt-1">
            <span className="font-medium">{formatHebrewDate(d.date)}:</span>{" "}
            {d.equipment.join(" · ")}
          </p>
        ))}
    </section>
  );

  if (sent) {
    return (
      <div className="mb-10 flex flex-col gap-3">
        <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-center shadow-sm">
          <h1 className="text-xl font-bold text-emerald-900">ההרשמה נשלחה</h1>
          <p className="mt-1 text-sm text-emerald-800">{form.eventName}</p>
        </div>
        {sent.entries.map((e, i) => {
          const r = sent.results[i];
          const name = e.pick === NEW ? e.newName : nameOf(e.pick);
          return (
            <section key={e.key} className="rounded-2xl bg-white p-4 text-sm shadow-sm">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-base font-semibold text-slate-900">{name}</span>
                {/* Pending and approved read the same: the form does not tell
                    anyone what an adult still has to look at. */}
                <span
                  className={
                    r?.outcome === "waitlist"
                      ? "font-semibold text-amber-700"
                      : "font-semibold text-emerald-700"
                  }
                >
                  {r?.outcome === "waitlist" ? "נרשמת לרשימת ההמתנה" : "התקבל"}
                </span>
              </div>
              <ul className="flex flex-col gap-0.5 text-slate-700">
                {form.days.map((d) => {
                  const c = e.days[d.id];
                  return (
                    <li key={d.id}>
                      {formatHebrewDate(d.date)}:{" "}
                      {c?.coming
                        ? `מגיע/ה${c.bringsFood ? ", עם אוכל" : ", בלי אוכל"}`
                        : "לא מגיע/ה"}
                    </li>
                  );
                })}
                <li className="mt-1">
                  חזרה הביתה:{" "}
                  {e.dismissal === "alone"
                    ? "הולך/ת לבד"
                    : `${e.pickupName}${e.pickupRelation ? ` (${e.pickupRelation})` : ""} אוסף/ת`}
                </li>
              </ul>
            </section>
          );
        })}
        {equipmentBox}
        <p className="text-center text-xs leading-relaxed text-slate-500">
          אפשר לצלם את המסך הזה כתזכורת. כדי לשנות משהו — שולחים שוב, וההרשמה
          החדשה מחליפה את הקודמת.
        </p>
        <button
          type="button"
          onClick={() => setSent(null)}
          className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-700"
        >
          שינוי ההרשמה
        </button>
      </div>
    );
  }

  return (
    <div className="mb-10 flex flex-col gap-3">
      {header}

      {full && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          כרגע יש רשימת המתנה. אפשר עדיין להירשם — ההרשמה תיכנס אליה לפי סדר,
          והצוות יאשר כשיתפנה מקום.
        </p>
      )}

      {equipmentBox}

      {entries.map((e, index) => (
        <section
          key={e.key}
          className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm"
          aria-label={`ילד/ה ${index + 1}`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              {entries.length > 1 ? `ילד/ה ${index + 1}` : "פרטי הילד/ה"}
            </h2>
            {entries.length > 1 && (
              <button
                type="button"
                onClick={() => setEntries((list) => list.filter((x) => x.key !== e.key))}
                className="text-sm text-slate-500 underline"
              >
                הסרה
              </button>
            )}
          </div>

          <Field label="שם הילד/ה">
            <select
              value={e.pick}
              onChange={(ev) => patch(e.key, { pick: ev.target.value })}
              className={INPUT}
            >
              <option value="">בחירה מהרשימה…</option>
              {byGrade.map((g) => (
                <optgroup key={g.grade} label={g.grade}>
                  {g.children.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={NEW}>➕ ילד/ה שלא ברשימה</option>
            </select>
          </Field>

          {e.pick === NEW && (
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <Field label="שם מלא">
                <input
                  value={e.newName}
                  onChange={(ev) => patch(e.key, { newName: ev.target.value })}
                  className={INPUT}
                  autoComplete="off"
                />
              </Field>
              <Field label="כיתה">
                <input
                  value={e.newGrade}
                  onChange={(ev) => patch(e.key, { newGrade: ev.target.value })}
                  className={INPUT}
                  placeholder="א׳"
                />
              </Field>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {form.days.map((d) => {
              const c = e.days[d.id];
              return (
                <div key={d.id} className="rounded-xl border border-slate-200 p-3">
                  <p className="mb-2 text-sm font-semibold text-slate-800">
                    {form.days.length > 1 ? formatHebrewDate(d.date) : "מגיע/ה?"}
                    {d.equipment.length > 0 && (
                      <span className="mr-2 font-normal text-amber-800">
                        · להביא: {d.equipment.join(", ")}
                      </span>
                    )}
                  </p>
                  <Pair
                    value={c?.coming ?? null}
                    yes="מגיע/ה"
                    no="לא מגיע/ה"
                    onChange={(v) => patchDay(e.key, d.id, { coming: v })}
                  />
                  {c?.coming && (
                    <div className="mt-2">
                      <p className="mb-1 text-xs font-medium text-slate-600">מגיע/ה עם אוכל?</p>
                      <Pair
                        value={c.bringsFood}
                        yes="כן, עם אוכל"
                        no="בלי אוכל"
                        onChange={(v) => patchDay(e.key, d.id, { bringsFood: v })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <p className="mb-1 text-sm font-semibold text-slate-800">איך חוזר/ת הביתה?</p>
            <Pair
              neutral
              value={e.dismissal === "" ? null : e.dismissal === "alone"}
              yes="הולך/ת לבד"
              no="באים לאסוף"
              onChange={(v) => patch(e.key, { dismissal: v ? "alone" : "escort" })}
            />
          </div>

          {e.dismissal === "escort" && (
            <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3">
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <Field label="מי אוסף/ת">
                  <input
                    value={e.pickupName}
                    onChange={(ev) => patch(e.key, { pickupName: ev.target.value })}
                    className={INPUT}
                  />
                </Field>
                <Field label="קרבה">
                  <input
                    value={e.pickupRelation}
                    onChange={(ev) => patch(e.key, { pickupRelation: ev.target.value })}
                    className={INPUT}
                    placeholder="סבתא"
                  />
                </Field>
              </div>
              <Field label="הטלפון של מי שאוסף/ת">
                <input
                  value={e.pickupPhone}
                  onChange={(ev) => patch(e.key, { pickupPhone: ev.target.value })}
                  className={INPUT}
                  inputMode="tel"
                  dir="ltr"
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <Field label="שם ההורה שממלא/ת">
              <input
                value={e.parentName}
                onChange={(ev) => patch(e.key, { parentName: ev.target.value })}
                className={INPUT}
                autoComplete="name"
              />
            </Field>
            <Field label="טלפון">
              <input
                value={e.parentPhone}
                onChange={(ev) => patch(e.key, { parentPhone: ev.target.value })}
                className={INPUT}
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
              />
            </Field>
          </div>

          <Field label="הערה לצוות (לא חובה)">
            <textarea
              value={e.note}
              onChange={(ev) => patch(e.key, { note: ev.target.value })}
              maxLength={NOTE_MAX}
              rows={2}
              className={INPUT}
            />
          </Field>
        </section>
      ))}

      {entries.length < MAX_CHILDREN_PER_SUBMISSION && (
        <button
          type="button"
          onClick={addSibling}
          className="min-h-12 rounded-xl border border-dashed border-slate-400 bg-white px-4 py-3 text-base font-semibold text-slate-700"
        >
          + הוספת ילד/ה נוסף/ת
        </button>
      )}

      {hasEquipment && (
        <label className="flex items-start gap-3 rounded-xl bg-white p-4 text-sm text-slate-800 shadow-sm">
          <input
            type="checkbox"
            checked={equipmentAck}
            onChange={(ev) => setEquipmentAck(ev.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          קראתי את רשימת הציוד
        </label>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={sending}
        className="min-h-12 rounded-xl bg-emerald-600 px-4 py-3 text-lg font-bold text-white disabled:opacity-60"
      >
        {sending ? "שולח…" : "שליחת ההרשמה"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      {children}
    </label>
  );
}

// Two buttons rather than a toggle or a radio: a toggle needs you to know
// which way is "yes", and these are tapped with a thumb.
function Pair({
  value,
  yes,
  no,
  onChange,
  neutral = false,
}: {
  neutral?: boolean;
  value: boolean | null;
  yes: string;
  no: string;
  onChange: (v: boolean) => void;
}) {
  const base = "min-h-11 rounded-xl border px-2 py-2 text-sm font-semibold transition";
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        aria-pressed={value === true}
        onClick={() => onChange(true)}
        className={`${base} ${value === true ? (neutral ? "border-slate-600 bg-slate-600 text-white" : "border-emerald-600 bg-emerald-600 text-white") : "border-slate-300 bg-white text-slate-700"}`}
      >
        {yes}
      </button>
      <button
        type="button"
        aria-pressed={value === false}
        onClick={() => onChange(false)}
        className={`${base} ${value === false ? "border-slate-600 bg-slate-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
      >
        {no}
      </button>
    </div>
  );
}
