"use client";

import { useMemo, useState } from "react";
import { parseRoster, partitionByExisting } from "@/lib/participants";

type Group = { id: string; name: string };

// Paste a list, see exactly what will happen, then commit. The preview is the
// point: a bulk write into a live roster should never be a surprise.
export default function RosterImport({
  existingNames,
  groups,
  onImported,
}: {
  existingNames: string[];
  groups: Group[];
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const parsed = useMemo(() => parseRoster(text), [text]);
  const { fresh, duplicate } = useMemo(
    () => partitionByExisting(parsed.rows, existingNames),
    [parsed.rows, existingNames],
  );

  async function readFile(file: File) {
    setError(null);
    try {
      setText(await file.text());
    } catch {
      setError("קריאת הקובץ נכשלה");
    }
  }

  async function submit() {
    if (fresh.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/participants/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: fresh, groupId: groupId || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "הייבוא נכשל");
      setResult(
        `נוספו ${data.added} ילדים` +
          (data.skipped ? ` · ${data.skipped} דולגו (כבר קיימים)` : ""),
      );
      setText("");
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
      >
        ⬆ ייבוא רשימה שלמה
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-900">ייבוא רשימה</span>
        <button
          onClick={() => {
            setOpen(false);
            setText("");
            setResult(null);
            setError(null);
          }}
          className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100"
        >
          סגירה
        </button>
      </div>

      <p className="text-xs text-slate-500">
        שורה לכל ילד/ה. אפשר להדביק מגיליון או לכתוב ידנית. הסדר:{" "}
        <span className="font-semibold">שם, כיתה, שם הורה, טלפון</span> — הכול חוץ
        מהשם אופציונלי.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        dir="rtl"
        rows={6}
        placeholder={"דנה כהן, ג׳, רותי כהן, 050-1234567\nאבי לוי, א׳"}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
      />

      <label className="text-xs text-slate-500">
        או קובץ (CSV / טקסט):
        <input
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
          }}
          className="mt-1 block w-full text-sm"
        />
      </label>

      {groups.length > 0 && (
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          לצרף את כולם לקבוצה (אופציונלי):
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800"
          >
            <option value="">בלי קבוצה</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Preview */}
      {parsed.rows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="mb-2 font-semibold text-slate-700">
            זוהו {parsed.rows.length} שורות · {fresh.length} ייווספו
            {duplicate.length > 0 && ` · ${duplicate.length} כבר קיימים וידולגו`}
          </div>
          <ul className="max-h-44 overflow-y-auto">
            {fresh.slice(0, 50).map((r, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 py-0.5 text-slate-700">
                <span className="font-medium">{r.name}</span>
                {r.grade && <span className="text-slate-500">{r.grade}</span>}
                {r.parentName && (
                  <span className="text-slate-400">{r.parentName}</span>
                )}
                {r.parentPhone && (
                  <span className="text-slate-400" dir="ltr">
                    {r.parentPhone}
                  </span>
                )}
              </li>
            ))}
            {fresh.length > 50 && (
              <li className="py-0.5 text-slate-400">
                …ועוד {fresh.length - 50}
              </li>
            )}
          </ul>
          {duplicate.length > 0 && (
            <div className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
              ידולגו: {duplicate.map((r) => r.name).join(", ")}
            </div>
          )}
          {parsed.skipped.length > 0 && (
            <div className="mt-2 text-xs text-absent">
              שורות שלא הצלחתי לקרוא: {parsed.skipped.join(", ")}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {result && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {result}
        </p>
      )}

      <button
        onClick={submit}
        disabled={busy || fresh.length === 0}
        className="w-fit rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "מייבא…" : `הוספת ${fresh.length} ילדים`}
      </button>
    </div>
  );
}
