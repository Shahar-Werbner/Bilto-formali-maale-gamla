"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatHebrewDate } from "@/lib/events";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";

type User = { id: string; name: string; email: string; role: string };
type DeletedEvent = { id: string; name: string; startDate: string };
type DeletedParticipant = { id: string; name: string; grade: string | null };

export default function AdminPanel({
  currentUserId,
  users: initialUsers,
  deletedEvents,
  deletedParticipants,
}: {
  currentUserId: string;
  users: User[];
  deletedEvents: DeletedEvent[];
  deletedParticipants: DeletedParticipant[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [error, setError] = useState<string | null>(null);

  async function setRole(id: string, role: string) {
    setError(null);
    const prev = users;
    setUsers((list) => list.map((u) => (u.id === id ? { ...u, role } : u)));
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "שינוי התפקיד נכשל");
    } catch (err) {
      setUsers(prev);
      setError((err as Error).message);
    }
  }

  async function restore(kind: "event" | "participant", id: string) {
    setError(null);
    try {
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "השחזור נכשל");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-slate-900">ניהול</h1>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-lg font-bold text-slate-900">
          משתמשי צוות ({users.length})
        </h2>
        <p className="mb-2 text-sm text-slate-500">
          מנהל/ת יכול/ה למחוק אירועים וילדים, לשחזר אותם, ולשנות תפקידים. שינוי
          תפקיד נכנס לתוקף מיד.
        </p>
        <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {users.map((u, i) => (
            <li
              key={u.id}
              className={`flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0 ${
                i % 2 === 1 ? "bg-slate-50" : "bg-white"
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">
                  {u.name}
                  {u.id === currentUserId && (
                    <span className="mr-2 text-xs text-slate-400">(את/ה)</span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-400" dir="ltr">
                  {u.email}
                </div>
              </div>
              <select
                value={u.role}
                onChange={(e) => setRole(u.id, e.target.value)}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {ROLES.map((r: Role) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold text-slate-900">סל המחזור</h2>
        <p className="mb-2 text-sm text-slate-500">
          אירועים וילדים שנמחקו. הנתונים שלהם נשמרו — שחזור מחזיר אותם בדיוק כפי
          שהיו, כולל הנוכחות.
        </p>

        <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-600">
          אירועים ({deletedEvents.length})
        </h3>
        {deletedEvents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-400">
            אין אירועים שנמחקו.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {deletedEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">
                    {e.name}
                  </div>
                  <div className="text-xs text-slate-400" dir="ltr">
                    {formatHebrewDate(e.startDate)}
                  </div>
                </div>
                <button
                  onClick={() => restore("event", e.id)}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  שחזור
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-600">
          ילדים ({deletedParticipants.length})
        </h3>
        {deletedParticipants.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-400">
            אין ילדים שנמחקו.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {deletedParticipants.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0 truncate font-medium text-slate-800">
                  {p.name}
                  {p.grade && (
                    <span className="mr-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {p.grade}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => restore("participant", p.id)}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  שחזור
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
