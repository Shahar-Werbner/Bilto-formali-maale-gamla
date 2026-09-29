"use client";

import { useMemo, useState } from "react";
import type { BankActivity } from "@/lib/activity-query";
import {
  GRADE_CHOICES,
  VERDICT_ICON,
  fitsGrade,
  gradeRangeLabel,
  isVerdict,
} from "@/lib/activities";

type Form = {
  name: string;
  description: string;
  durationMinutes: string;
  materials: string;
  tags: string;
  minGrade: string;
  maxGrade: string;
};

const EMPTY: Form = {
  name: "",
  description: "",
  durationMinutes: "",
  materials: "",
  tags: "",
  minGrade: "",
  maxGrade: "",
};

function toForm(a: BankActivity): Form {
  return {
    name: a.name,
    description: a.description ?? "",
    durationMinutes: a.durationMinutes ? String(a.durationMinutes) : "",
    materials: a.materials ?? "",
    tags: a.tags.join(", "),
    minGrade: a.minGrade ?? "",
    maxGrade: a.maxGrade ?? "",
  };
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error ?? fallback;
}

export default function ActivityBank({
  initialActivities,
  canEdit,
}: {
  initialActivities: BankActivity[];
  canEdit: boolean;
}) {
  const [activities, setActivities] = useState(initialActivities);
  const [q, setQ] = useState("");
  const [grade, setGrade] = useState("");
  const [tag, setTag] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState<BankActivity[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Tags by how often they are used — the chip row shows what the bank is
  // actually made of, most common first.
  const tags = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of activities) for (const t of a.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12);
  }, [activities]);

  const needle = q.trim();
  const shown = activities.filter(
    (a) =>
      (!needle ||
        a.name.includes(needle) ||
        (a.description ?? "").includes(needle) ||
        a.tags.some((t) => t.includes(needle))) &&
      (!tag || a.tags.includes(tag)) &&
      (!grade || fitsGrade(a, grade)),
  );

  async function reload() {
    const res = await fetch("/api/activities");
    if (res.ok) setActivities(await res.json());
  }

  async function save(id: string | "new", f: Form) {
    setError(null);
    const body = {
      ...f,
      durationMinutes: f.durationMinutes.trim() ? Number(f.durationMinutes) : null,
    };
    const res = await fetch(id === "new" ? "/api/activities" : `/api/activities/${id}`, {
      method: id === "new" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(await readError(res, "השמירה נכשלה"));
      return;
    }
    setEditingId(null);
    await reload();
  }

  async function archive(a: BankActivity) {
    if (!confirm(`להעביר את "${a.name}" לארכיון? הדירוגים נשמרים ואפשר להחזיר.`)) return;
    setError(null);
    const res = await fetch(`/api/activities/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await readError(res, "ההעברה לארכיון נכשלה"));
      return;
    }
    setActivities((cur) => cur.filter((x) => x.id !== a.id));
    setArchived(null);
    setShowArchived(false);
  }

  async function toggleArchived() {
    if (showArchived) {
      setShowArchived(false);
      return;
    }
    setShowArchived(true);
    const res = await fetch("/api/activities?archived=1");
    if (res.ok) setArchived(await res.json());
    else setError("טעינת הארכיון נכשלה");
  }

  async function restore(a: BankActivity) {
    setError(null);
    const res = await fetch(`/api/activities/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restore: true }),
    });
    if (!res.ok) {
      setError(await readError(res, "השחזור נכשל"));
      return;
    }
    setArchived((cur) => cur?.filter((x) => x.id !== a.id) ?? null);
    await reload();
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">מאגר פעילויות</h1>
        <p className="text-sm text-slate-500">
          מה שעשינו, מסודר לפי מה שעבד. בוחרים מכאן ללוז, ומדרגים ביום עצמו.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {canEdit &&
        (editingId === "new" ? (
          <ActivityForm
            initial={EMPTY}
            submitLabel="הוספה למאגר"
            onSubmit={(f) => save("new", f)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <button
            onClick={() => setEditingId("new")}
            className="w-full rounded-lg border border-dashed border-slate-300 bg-white py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            + פעילות חדשה למאגר
          </button>
        ))}

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          aria-label="כיתה"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-base"
        >
          <option value="">כל הכיתות</option>
          {GRADE_CHOICES.map((g) => (
            <option key={g} value={g}>
              כיתה {g}
            </option>
          ))}
        </select>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? "" : t)}
              aria-pressed={tag === t}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                tag === t
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-600"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {activities.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          המאגר עוד ריק. מוסיפים כאן, או בלחיצה על &quot;📚 שמירה במאגר&quot; ליד פעילות בלוז של יום.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-400">אין פעילות שמתאימה לסינון.</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {shown.map((a) =>
          editingId === a.id ? (
            <li key={a.id}>
              <ActivityForm
                initial={toForm(a)}
                submitLabel="שמירה"
                onSubmit={(f) => save(a.id, f)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={a.id} className="rounded-xl border border-slate-200 bg-white">
              <button
                onClick={() => setOpenId(openId === a.id ? null : a.id)}
                aria-expanded={openId === a.id}
                className="flex w-full items-start justify-between gap-2 p-3 text-right"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{a.name}</div>
                  <div className="text-xs text-slate-500">
                    {[
                      a.durationMinutes ? `${a.durationMinutes} דק'` : null,
                      gradeRangeLabel(a.minGrade, a.maxGrade),
                      a.tags.join(" · ") || null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || " "}
                  </div>
                </div>
                <Tally a={a} />
              </button>
              {openId === a.id && (
                <div className="flex flex-col gap-2 border-t border-slate-100 px-3 pb-3 pt-2 text-sm text-slate-700">
                  {a.description && <p className="whitespace-pre-line">{a.description}</p>}
                  {a.materials && (
                    <p>
                      <span className="font-semibold">ציוד: </span>
                      {a.materials}
                    </p>
                  )}
                  <p className="text-xs text-slate-500">
                    {a.timesUsed > 0 ? `שובצה בלוז ${a.timesUsed} פעמים` : "עוד לא שובצה בלוז"}
                    {a.summary.total > 0 &&
                      ` · ${a.summary.worked} עבד, ${a.summary.flopped} לא עבד, ${a.summary.wrongAge} לא מתאים לגיל`}
                  </p>
                  {a.notes.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {a.notes.map((n, i) => (
                        <li key={i} className="rounded-lg bg-slate-50 px-2 py-1 text-xs">
                          {isVerdict(n.verdict) ? VERDICT_ICON[n.verdict] : ""} {n.note}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canEdit && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingId(a.id)}
                        className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                      >
                        עריכה
                      </button>
                      <button
                        onClick={() => archive(a)}
                        className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-red-50 hover:text-absent"
                      >
                        לארכיון
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ),
        )}
      </ul>

      {canEdit && (
        <div className="mt-2">
          <button onClick={toggleArchived} className="text-sm text-slate-500 hover:underline">
            {showArchived ? "הסתרת הארכיון" : "ארכיון"}
          </button>
          {showArchived && (
            <ul className="mt-2 flex flex-col gap-1">
              {archived === null && <li className="text-sm text-slate-400">טוען…</li>}
              {archived?.length === 0 && (
                <li className="text-sm text-slate-400">הארכיון ריק.</li>
              )}
              {archived?.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate text-slate-600">{a.name}</span>
                  <button
                    onClick={() => restore(a)}
                    className="shrink-0 rounded-lg px-2 py-1 font-semibold text-slate-700 hover:bg-white"
                  >
                    החזרה למאגר
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// The three counts, always in the same order, so a glance down the list reads
// as a column. "Not rated yet" is said in words — a row of zeros looks like
// three failures.
function Tally({ a }: { a: BankActivity }) {
  if (a.summary.total === 0) {
    return <span className="shrink-0 text-xs text-slate-400">עוד לא דורגה</span>;
  }
  return (
    <span className="flex shrink-0 gap-2 text-sm font-semibold" dir="ltr">
      <span className="text-present">
        {VERDICT_ICON.worked} {a.summary.worked}
      </span>
      <span className="text-absent">
        {VERDICT_ICON.flopped} {a.summary.flopped}
      </span>
      <span className="text-slate-500">
        {VERDICT_ICON.wrong_age} {a.summary.wrongAge}
      </span>
    </span>
  );
}

function ActivityForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Form;
  submitLabel: string;
  onSubmit: (f: Form) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<Form>(initial);
  const set =
    (k: keyof Form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (f.name.trim()) onSubmit(f);
      }}
      className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
    >
      <input
        value={f.name}
        onChange={set("name")}
        placeholder="שם הפעילות (למשל: מחבואים עם פנסים)"
        required
        className="rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <textarea
        value={f.description}
        onChange={set("description")}
        placeholder="איך מעבירים אותה — מה שהמדריך/ה הבא/ה צריך/ה לדעת"
        rows={3}
        className="rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col text-xs text-slate-500">
          משך (דקות)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={480}
            value={f.durationMinutes}
            onChange={set("durationMinutes")}
            className="rounded-lg border border-slate-300 px-2 py-2 text-base"
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col text-xs text-slate-500">
          מכיתה
          <select
            value={f.minGrade}
            onChange={set("minGrade")}
            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-base"
          >
            <option value="">—</option>
            {GRADE_CHOICES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col text-xs text-slate-500">
          עד כיתה
          <select
            value={f.maxGrade}
            onChange={set("maxGrade")}
            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-base"
          >
            <option value="">—</option>
            {GRADE_CHOICES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        value={f.materials}
        onChange={set("materials")}
        placeholder="ציוד (למשל: פנסים, חבל, 2 כדורים)"
        className="rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <input
        value={f.tags}
        onChange={set("tags")}
        placeholder="תגיות, מופרדות בפסיק: חוץ, יצירה, גשם"
        className="rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <div className="flex gap-2">
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
          {submitLabel}
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
