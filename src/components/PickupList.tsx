"use client";

import { useEffect, useState } from "react";
import {
  DISMISSAL_METHODS,
  DISMISSAL_METHOD_LABEL,
  dismissalMethodOf,
  type DismissalMethod,
} from "@/lib/dismissal";

type Authorization = {
  id: string;
  name: string;
  relation: string | null;
  phone?: string | null;
};

// Who may take this child home, and the standing instruction for how they go.
//
// It lives on the child's row in the roster rather than on the day screen
// because it is a standing fact about the child, not something decided at the
// gate. What happens at the gate is a Dismissal, and it is checked against
// this list.
//
// Loaded when the row is opened, not with the roster: 50 children times their
// pickup lists is a lot of rows to fetch for a screen where the usual answer
// is "nobody opened this".
export default function PickupList({
  participantId,
  participantName,
}: {
  participantId: string;
  participantName: string;
}) {
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [defaultDismissal, setDefaultDismissal] =
    useState<DismissalMethod>("escort");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/participants/${participantId}/pickup`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        setAuthorizations(data.authorizations ?? []);
        setDefaultDismissal(dismissalMethodOf(data.defaultDismissal));
      } catch {
        if (!cancelled) setError("טעינת מורשי האיסוף נכשלה");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [participantId]);

  async function setInstruction(method: DismissalMethod) {
    const prev = defaultDismissal;
    setDefaultDismissal(method);
    setError(null);
    try {
      const res = await fetch(`/api/participants/${participantId}/pickup`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultDismissal: method }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setDefaultDismissal(prev);
      setError("שינוי ההוראה הקבועה נכשל");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const res = await fetch(`/api/participants/${participantId}/pickup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, relation, phone }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setAuthorizations((list) => [...list, created]);
      setName("");
      setRelation("");
      setPhone("");
    } catch {
      setError("הוספת מורשה איסוף נכשלה");
    }
  }

  async function remove(authorizationId: string, who: string) {
    if (
      !confirm(`להסיר את ${who} מרשימת מורשי האיסוף של ${participantName}?`)
    )
      return;
    const prev = authorizations;
    setAuthorizations((list) => list.filter((a) => a.id !== authorizationId));
    try {
      const res = await fetch(
        `/api/participants/${participantId}/pickup?authorizationId=${authorizationId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
    } catch {
      setAuthorizations(prev);
      setError("ההסרה נכשלה");
    }
  }

  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-700">שחרור ומורשי איסוף</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {DISMISSAL_METHODS.map((m) => (
          <button
            key={m}
            onClick={() => setInstruction(m)}
            aria-pressed={defaultDismissal === m}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              defaultDismissal === m
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {DISMISSAL_METHOD_LABEL[m]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-2 text-xs text-slate-400">טוען…</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {authorizations.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-slate-800">
                {a.name}
                {a.relation && (
                  <span className="text-slate-500"> · {a.relation}</span>
                )}
              </span>
              {a.phone && (
                <a
                  href={`tel:${a.phone}`}
                  aria-label={`התקשרות ל${a.name}`}
                  className="shrink-0 rounded-lg px-2 py-1 text-base leading-none hover:bg-slate-200"
                >
                  📞
                </a>
              )}
              <button
                onClick={() => remove(a.id, a.name)}
                aria-label={`הסרת ${a.name}`}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-absent"
              >
                הסרה
              </button>
            </li>
          ))}
          {authorizations.length === 0 && (
            // Said plainly, because an empty list is not a neutral state: with
            // the standing instruction on "waiting for an adult" it means
            // nobody can collect this child without an adult counselor.
            <li className="text-xs text-slate-500">
              אין מורשי איסוף ברשימה.
              {defaultDismissal === "escort" &&
                " כל איסוף יחייב אישור של מדריך/ה בוגר/ת."}
            </li>
          )}
        </ul>
      )}

      <form onSubmit={add} className="mt-2 grid gap-2 sm:grid-cols-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם"
          aria-label={`מורשה איסוף חדש עבור ${participantName}`}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          placeholder="קרבה (אמא, סבתא…)"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="טלפון"
          type="tel"
          dir="ltr"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="w-fit rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
        >
          + הוספה
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
