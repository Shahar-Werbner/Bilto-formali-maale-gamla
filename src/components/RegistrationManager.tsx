"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatHebrewDate, formatTimeRange } from "@/lib/events";
import { todayDateOnly } from "@/lib/attendance";
import { DISMISSAL_METHOD_LABEL, dismissalMethodOf } from "@/lib/dismissal";
import {
  EQUIPMENT_SUGGESTIONS,
  REGISTRATION_STATUS_LABEL,
  REVIEW_REASON_LABEL,
  formDays,
  registrationUrl,
  type FormState,
  type RegistrationStatus,
  type ReviewReason,
} from "@/lib/registration";
import type { StaffRegistration } from "@/lib/registration-server";

// The staff side of the registration form (item 8a): set it up, send the
// link, close it, and approve what has to be approved. Read on a phone by an
// adult counselor, often the evening before — so the queue comes first once
// the link is out, and every card says in words what is a change.

type Day = {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  equipment: string[];
};

type FormData = {
  token: string;
  state: FormState;
  intro: string | null;
  price: string | null;
  capacity: number | null;
  autoApprove: boolean;
  closesAt: string;
  equipment: string[];
};

const INPUT =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-slate-500 focus:outline-none";
const BUTTON =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const PRIMARY =
  "min-h-11 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50";

const STATE_LABEL: Record<FormState, string> = {
  draft: "טרם נשלח",
  open: "פתוח להרשמה",
  closed: "סגור",
};

export default function RegistrationManager({
  event,
  form,
  registrations,
  canApplyContact,
}: {
  event: { id: string; name: string; kind: "camp" | "recurring"; days: Day[] };
  form: FormData | null;
  registrations: StaffRegistration[];
  canApplyContact: boolean;
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const link = form && origin ? registrationUrl(origin, form.token) : "";
  const queue = registrations.filter((r) => r.needsReview && r.status !== "waitlist");
  const waitlist = registrations.filter((r) => r.status === "waitlist");
  const approved = registrations.filter((r) => r.status === "approved");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage({ tone: "ok", text: "הקישור הועתק — אפשר להדביק בקבוצה" });
    } catch {
      // Clipboard is refused often enough on phones that a silent failure
      // would look like a dead button. The link itself is still usable.
      setMessage({ tone: "ok", text: link });
    }
  }

  async function linkAction(action: "open" | "close" | "reissue") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${event.id}/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ tone: "error", text: data?.error ?? "הפעולה נכשלה" });
        return;
      }
      if (action === "open" || action === "reissue") {
        const url = registrationUrl(window.location.origin, data.token);
        try {
          await navigator.clipboard.writeText(url);
          setMessage({ tone: "ok", text: "ההרשמה פתוחה והקישור הועתק — אפשר להדביק בקבוצה" });
        } catch {
          setMessage({ tone: "ok", text: url });
        }
      } else {
        setMessage({ tone: "ok", text: "ההרשמה נסגרה" });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function openLink() {
    // A warning, not a block: some events need nothing packed.
    const hasEquipment =
      (form?.equipment.length ?? 0) > 0 || event.days.some((d) => d.equipment.length > 0);
    if (!hasEquipment && !window.confirm("לא הוגדרה רשימת ציוד — לשלוח בלי?")) return;
    void linkAction("open");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <a href={`/events/${event.id}`} className="text-sm text-slate-500 underline">
          → חזרה לאירוע
        </a>
        <h1 className="mt-1 text-xl font-bold text-slate-900">טופס הרשמה · {event.name}</h1>
      </div>

      {message && (
        <p
          className={`break-all rounded-lg px-3 py-2 text-sm ${
            message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}
          role="status"
        >
          {message.text}
        </p>
      )}

      {form && (
        <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">הקישור</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                form.state === "open"
                  ? "bg-emerald-100 text-emerald-800"
                  : form.state === "closed"
                    ? "bg-slate-200 text-slate-700"
                    : "bg-amber-100 text-amber-800"
              }`}
            >
              {STATE_LABEL[form.state]}
            </span>
          </div>

          {form.state === "draft" ? (
            <>
              <p className="text-sm text-slate-600">
                כשההגדרות מוכנות: פותחים את ההרשמה, והקישור מועתק להדבקה בקבוצת
                ההורים.
              </p>
              <button type="button" onClick={openLink} disabled={busy} className={PRIMARY}>
                פתיחת ההרשמה והעתקת הקישור
              </button>
            </>
          ) : (
            <>
              <p dir="ltr" className="break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {link}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyLink} className={BUTTON}>
                  העתקת הקישור
                </button>
                {form.state === "open" ? (
                  <button
                    type="button"
                    onClick={() => linkAction("close")}
                    disabled={busy}
                    className={BUTTON}
                  >
                    סגירת ההרשמה
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => linkAction("open")}
                    disabled={busy}
                    className={BUTTON}
                  >
                    פתיחה מחדש
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "להחליף את הקישור? הקישור הישן יפסיק לעבוד מיד, וצריך לשלוח לקבוצה את החדש.",
                      )
                    ) {
                      void linkAction("reissue");
                    }
                  }}
                  disabled={busy}
                  className={BUTTON}
                >
                  החלפת קישור
                </button>
              </div>
              {form.state === "closed" && (
                <p className="text-xs text-slate-500">
                  אם מועד הסגירה עבר, צריך לעדכן אותו בהגדרות לפני פתיחה מחדש.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {form && form.state !== "draft" && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-slate-900">
            ממתינים לאישור{queue.length > 0 ? ` (${queue.length})` : ""}
          </h2>
          <p className="text-xs text-slate-500">
            {approved.length} רשומים · {waitlist.length} ברשימת המתנה
            {form.capacity !== null ? ` · מכסה ${form.capacity}` : ""}
          </p>
          {queue.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
              אין כרגע מה לאשר.
            </p>
          ) : (
            queue.map((r) => (
              <ReviewCard
                key={r.id}
                reg={r}
                days={event.days}
                canApplyContact={canApplyContact}
                onDone={(text) => {
                  setMessage({ tone: "ok", text });
                  router.refresh();
                }}
                onError={(text) => setMessage({ tone: "error", text })}
              />
            ))
          )}

          {waitlist.length > 0 && (
            <>
              <h2 className="mt-2 font-semibold text-slate-900">
                רשימת המתנה ({waitlist.length})
              </h2>
              <p className="text-xs text-slate-500">לפי סדר ההרשמה. כשמתפנה מקום — מאשרים מכאן.</p>
              {waitlist.map((r) => (
                <ReviewCard
                  key={r.id}
                  reg={r}
                  days={event.days}
                  canApplyContact={canApplyContact}
                  onDone={(text) => {
                    setMessage({ tone: "ok", text });
                    router.refresh();
                  }}
                  onError={(text) => setMessage({ tone: "error", text })}
                />
              ))}
            </>
          )}
        </section>
      )}

      <Settings
        event={event}
        form={form}
        onSaved={() => {
          setMessage({ tone: "ok", text: "ההגדרות נשמרו" });
          router.refresh();
        }}
        onError={(text) => setMessage({ tone: "error", text })}
      />
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function Settings({
  event,
  form,
  onSaved,
  onError,
}: {
  event: { id: string; kind: "camp" | "recurring"; days: Day[] };
  form: FormData | null;
  onSaved: () => void;
  onError: (text: string) => void;
}) {
  const [intro, setIntro] = useState(form?.intro ?? "");
  const [price, setPrice] = useState(form?.price ?? "");
  const [closesAt, setClosesAt] = useState(form?.closesAt ?? "");
  const [capacity, setCapacity] = useState(form?.capacity?.toString() ?? "");
  const [autoApprove, setAutoApprove] = useState(form?.autoApprove ?? true);
  const [equipment, setEquipment] = useState<string[]>(form?.equipment ?? []);
  const [dayEquipment, setDayEquipment] = useState<Record<string, string[]>>(
    Object.fromEntries(event.days.map((d) => [d.id, d.equipment])),
  );
  const [saving, setSaving] = useState(false);

  // The days the form will ask about — the same rule the parent's page uses —
  // so a per-day item is only offered for a day a parent will actually see.
  const shownDays = useMemo(
    () => formDays(event.days, event.kind, todayDateOnly()),
    [event.days, event.kind],
  );

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${event.id}/registration`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intro,
          price,
          closesAt,
          capacity: capacity.trim() === "" ? null : Number(capacity),
          autoApprove,
          equipment,
          dayEquipment: Object.fromEntries(shownDays.map((d) => [d.id, dayEquipment[d.id] ?? []])),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) onError(data?.error ?? "השמירה נכשלה");
      else onSaved();
    } catch {
      onError("אין חיבור — ההגדרות לא נשמרו");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">הגדרות ההרשמה</h2>
      <p className="-mt-2 text-xs text-slate-500">
        שם האירוע, הימים והשעות נלקחים מהאירוע עצמו.
      </p>

      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        טקסט פתיחה להורים
        <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} className={INPUT} />
      </label>

      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          מחיר (לא חובה)
          <input value={price} onChange={(e) => setPrice(e.target.value)} className={INPUT} placeholder="50 ₪" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          מכסה (לא חובה)
          <input
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={INPUT}
            inputMode="numeric"
            placeholder="בלי הגבלה"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        ההרשמה נסגרת ב־ (שעון ישראל)
        <input
          type="datetime-local"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
          className={INPUT}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-slate-600">אישור הרשמות</legend>
        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input
            type="radio"
            checked={autoApprove}
            onChange={() => setAutoApprove(true)}
            className="mt-1 h-4 w-4"
          />
          <span>
            אוטומטי
            <span className="block text-xs text-slate-500">
              ילד/ה חדש/ה ושינוי באיסוף ממתינים לאישור בכל מקרה
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input
            type="radio"
            checked={!autoApprove}
            onChange={() => setAutoApprove(false)}
            className="mt-1 h-4 w-4"
          />
          <span>
            ידני
            <span className="block text-xs text-slate-500">
              כל הרשמה ממתינה עד שבוגר/ת מאשר/ת (למשל קייטנה בתשלום)
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-slate-600">ציוד לכל האירוע</p>
        <EquipmentEditor items={equipment} onChange={setEquipment} />
      </div>

      {shownDays.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium text-slate-600">תוספות ליום מסוים</p>
          {shownDays.map((d) => (
            <div key={d.id} className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-800">
                {formatHebrewDate(d.date)}{" "}
                <span dir="ltr" className="font-normal text-slate-500">
                  {formatTimeRange(d.startTime, d.endTime)}
                </span>
              </p>
              <EquipmentEditor
                items={dayEquipment[d.id] ?? []}
                onChange={(list) => setDayEquipment((m) => ({ ...m, [d.id]: list }))}
                compact
              />
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={save} disabled={saving} className={PRIMARY}>
        {saving ? "שומר…" : form ? "שמירת ההגדרות" : "יצירת טופס ההרשמה"}
      </button>
    </section>
  );
}

function EquipmentEditor({
  items,
  onChange,
  compact = false,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = (item: string) => {
    const t = item.trim();
    if (t && !items.includes(t)) onChange([...items, t]);
  };

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <li
              key={it}
              className="flex items-center gap-1 rounded-full bg-amber-100 py-1 pe-1 ps-3 text-sm text-amber-900"
            >
              {it}
              <button
                type="button"
                aria-label={`הסרת ${it}`}
                onClick={() => onChange(items.filter((x) => x !== it))}
                className="h-6 w-6 rounded-full text-amber-900 hover:bg-amber-200"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {EQUIPMENT_SUGGESTIONS.filter((s) => !items.includes(s)).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-600"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
              setDraft("");
            }
          }}
          className={INPUT}
          placeholder={compact ? "למשל: בגד ים" : "פריט אחר…"}
        />
        <button
          type="button"
          onClick={() => {
            add(draft);
            setDraft("");
          }}
          className={BUTTON}
        >
          הוספה
        </button>
      </div>
    </div>
  );
}

// ── One registration to decide on ───────────────────────────────────────────

function ReviewCard({
  reg,
  days,
  canApplyContact,
  onDone,
  onError,
}: {
  reg: StaffRegistration;
  days: Day[];
  canApplyContact: boolean;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const reasons = reg.reviewReasons as ReviewReason[];
  const pickupChange = reasons.includes("dismissal_alone") || reasons.includes("new_pickup");
  // Unticked by default: approving a registration changes nothing about who
  // takes the child home unless the adult chooses that.
  const [applyChanges, setApplyChanges] = useState(false);
  const [applyContact, setApplyContact] = useState(false);
  const [busy, setBusy] = useState(false);

  const dayById = new Map(days.map((d) => [d.id, d]));
  const answered = reg.days
    .filter((d) => dayById.has(d.eventDayId))
    .sort((a, b) => dayById.get(a.eventDayId)!.date.localeCompare(dayById.get(b.eventDayId)!.date));

  async function decide(action: "approve" | "reject") {
    if (action === "reject" && !window.confirm(`לדחות את ההרשמה של ${reg.childName}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/registrations/${reg.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, applyChanges, applyContact }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) onError(data?.error ?? "הפעולה נכשלה");
      else onDone(action === "approve" ? `${reg.childName} אושר/ה` : `ההרשמה של ${reg.childName} נדחתה`);
    } catch {
      onError("אין חיבור — לא נשמר");
    } finally {
      setBusy(false);
    }
  }

  const storedDismissal = reg.stored ? dismissalMethodOf(reg.stored.defaultDismissal) : null;

  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-semibold text-slate-900">
          {reg.childName}
          {reg.childGrade && <span className="font-normal text-slate-500"> · {reg.childGrade}</span>}
        </span>
        <span className="flex flex-wrap gap-1 text-xs">
          {reg.isNew && <Badge tone="amber">חדש/ה</Badge>}
          {reg.revision > 1 && <Badge tone="slate">עודכן</Badge>}
          <Badge tone="slate">
            {REGISTRATION_STATUS_LABEL[reg.status as RegistrationStatus] ?? reg.status}
          </Badge>
        </span>
      </div>

      <p className="text-slate-600">
        ביקש/ה: <span className="font-medium text-slate-800">{reg.parentName}</span>
        {reg.parentPhone && (
          <>
            {" · "}
            <a href={`tel:${reg.parentPhone}`} dir="ltr" className="underline">
              {reg.parentPhone}
            </a>
          </>
        )}
      </p>

      <ul className="text-slate-700">
        {answered.map((d) => (
          <li key={d.eventDayId}>
            {formatHebrewDate(dayById.get(d.eventDayId)!.date)}:{" "}
            {d.coming ? `מגיע/ה${d.bringsFood ? ", עם אוכל" : ", בלי אוכל"}` : "לא מגיע/ה"}
          </li>
        ))}
      </ul>

      <p className="text-slate-700">
        חזרה הביתה:{" "}
        {reg.dismissal === "alone"
          ? "הולך/ת לבד"
          : `${reg.pickupName ?? ""}${reg.pickupRelation ? ` (${reg.pickupRelation})` : ""} אוסף/ת`}
        {reg.dismissal === "escort" && reg.pickupPhone && (
          <>
            {" · "}
            <a href={`tel:${reg.pickupPhone}`} dir="ltr" className="underline">
              {reg.pickupPhone}
            </a>
          </>
        )}
      </p>

      {reasons.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
          {reasons.map((reason) => (
            <li key={reason}>
              <span className="font-semibold">{REVIEW_REASON_LABEL[reason] ?? reason}</span>
              {reason === "dismissal_alone" && storedDismissal && (
                <span> — השמור: {DISMISSAL_METHOD_LABEL[storedDismissal]}</span>
              )}
              {reason === "new_pickup" && reg.stored && (
                <span>
                  {" "}— מורשים שמורים:{" "}
                  {reg.stored.authorizations.length > 0
                    ? reg.stored.authorizations.map((a) => a.name).join(", ")
                    : "אין"}
                </span>
              )}
              {reason === "contact_differs" && (
                <span dir="auto">
                  {" "}— בהגשה {reg.parentPhone || "—"}, שמור {reg.stored?.parentPhone || "אין"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {reg.note && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">הערה: {reg.note}</p>
      )}

      {pickupChange && (
        <label className="flex items-start gap-2 text-slate-800">
          <input
            type="checkbox"
            checked={applyChanges}
            onChange={(e) => setApplyChanges(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          לאשר גם את השינוי באיסוף (בלי סימון — נשאר מה ששמור)
        </label>
      )}
      {reasons.includes("contact_differs") && canApplyContact && (
        <label className="flex items-start gap-2 text-slate-800">
          <input
            type="checkbox"
            checked={applyContact}
            onChange={(e) => setApplyContact(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          לעדכן את הטלפון השמור לזה שבהגשה
        </label>
      )}

      <div className="mt-1 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => decide("approve")} disabled={busy} className={PRIMARY}>
          אישור
        </button>
        <button type="button" onClick={() => decide("reject")} disabled={busy} className={BUTTON}>
          דחייה
        </button>
      </div>
    </article>
  );
}

function Badge({ tone, children }: { tone: "amber" | "slate"; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-semibold ${
        tone === "amber" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"
      }`}
    >
      {children}
    </span>
  );
}
