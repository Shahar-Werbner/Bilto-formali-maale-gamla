"use client";

import { useState } from "react";
import { sortByGrade } from "@/lib/attendance";

type Participant = { id: string; name: string; grade?: string | null };
type Group = { id: string; name: string; memberIds: string[] };

export default function RosterManager({
  initialParticipants,
  initialGroups,
}: {
  initialParticipants: Participant[];
  initialGroups: Group[];
}) {
  const [participants, setParticipants] =
    useState<Participant[]>(initialParticipants);
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [error, setError] = useState<string | null>(null);

  const byId = (id: string) => participants.find((p) => p.id === id);

  // ── master list ──────────────────────────────────────────────
  const [newName, setNewName] = useState("");
  const [newGrade, setNewGrade] = useState("");

  async function addParticipant(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const res = await fetch("/api/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, grade: newGrade.trim() }),
      });
      if (!res.ok) throw new Error();
      const p = await res.json();
      setParticipants((list) => [
        ...list,
        { id: p.id, name: p.name, grade: p.grade },
      ]);
      setNewName("");
      setNewGrade("");
    } catch {
      setError("הוספת הילד/ה נכשלה");
    }
  }

  async function updateGrade(id: string, grade: string) {
    const prev = participants;
    const value = grade.trim() || null;
    setParticipants((list) =>
      list.map((p) => (p.id === id ? { ...p, grade: value } : p)),
    );
    try {
      const res = await fetch(`/api/participants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: grade.trim() }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setParticipants(prev);
      setError("עדכון הכיתה נכשל");
    }
  }

  async function deleteParticipant(id: string) {
    if (!confirm("למחוק את הילד/ה מהמערכת (מכל הקבוצות)?")) return;
    const prevP = participants;
    const prevG = groups;
    setParticipants((list) => list.filter((p) => p.id !== id));
    setGroups((gs) =>
      gs.map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) })),
    );
    try {
      const res = await fetch(`/api/participants/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setParticipants(prevP);
      setGroups(prevG);
      setError("מחיקת הילד/ה נכשלה");
    }
  }

  // ── groups ───────────────────────────────────────────────────
  const [newGroupName, setNewGroupName] = useState("");

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const g = await res.json();
      setGroups((gs) => [...gs, { id: g.id, name: g.name, memberIds: [] }]);
      setNewGroupName("");
    } catch {
      setError("הוספת הקבוצה נכשלה");
    }
  }

  async function deleteGroup(id: string) {
    if (!confirm("למחוק את הקבוצה? (הילדים יישארו ברשימה הכללית)")) return;
    const prev = groups;
    setGroups((gs) => gs.filter((g) => g.id !== id));
    try {
      const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setGroups(prev);
      setError("מחיקת הקבוצה נכשלה");
    }
  }

  async function addMember(groupId: string, participantId: string) {
    if (!participantId) return;
    const prev = groups;
    setGroups((gs) =>
      gs.map((g) =>
        g.id === groupId
          ? { ...g, memberIds: [...g.memberIds, participantId] }
          : g,
      ),
    );
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setGroups(prev);
      setError("הוספה לקבוצה נכשלה");
    }
  }

  async function removeMember(groupId: string, participantId: string) {
    const prev = groups;
    setGroups((gs) =>
      gs.map((g) =>
        g.id === groupId
          ? { ...g, memberIds: g.memberIds.filter((m) => m !== participantId) }
          : g,
      ),
    );
    try {
      const res = await fetch(
        `/api/groups/${groupId}/members?participantId=${participantId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
    } catch {
      setGroups(prev);
      setError("הסרה מהקבוצה נכשלה");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Master list */}
      <section>
        <h2 className="mb-2 text-lg font-bold text-slate-900">
          כל הילדים ({participants.length})
        </h2>
        <form
          onSubmit={addParticipant}
          className="mb-2 flex gap-2 rounded-2xl border border-slate-200 bg-white p-3"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="שם ילד/ה"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          <input
            value={newGrade}
            onChange={(e) => setNewGrade(e.target.value)}
            placeholder="כיתה"
            className="w-16 shrink-0 rounded-lg border border-slate-300 px-2 py-2 text-center text-base"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white"
          >
            הוספה
          </button>
        </form>

        <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {sortByGrade(participants).map((p, i) => (
            <li
              key={p.id}
              className={`flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 last:border-b-0 ${
                i % 2 === 1 ? "bg-slate-50" : "bg-white"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                {p.name}
              </span>
              <input
                defaultValue={p.grade ?? ""}
                onBlur={(e) => {
                  if ((e.target.value.trim() || null) !== (p.grade ?? null)) {
                    updateGrade(p.id, e.target.value);
                  }
                }}
                placeholder="כיתה"
                className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm"
              />
              <button
                onClick={() => deleteParticipant(p.id)}
                className="rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:bg-red-50 hover:text-absent"
                aria-label={`מחיקת ${p.name}`}
              >
                מחיקה
              </button>
            </li>
          ))}
          {participants.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-400">
              אין ילדים עדיין. הוסיפו למעלה.
            </li>
          )}
        </ul>
      </section>

      {/* Groups */}
      <section>
        <h2 className="mb-2 text-lg font-bold text-slate-900">קבוצות</h2>
        <form
          onSubmit={addGroup}
          className="mb-2 flex gap-2 rounded-2xl border border-slate-200 bg-white p-3"
        >
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="שם קבוצה חדשה"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
          >
            הוספה
          </button>
        </form>

        <div className="flex flex-col gap-3">
          {groups.map((group) => {
            const members = sortByGrade(
              group.memberIds
                .map(byId)
                .filter((p): p is Participant => !!p),
            );
            const nonMembers = sortByGrade(
              participants.filter((p) => !group.memberIds.includes(p.id)),
            );
            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <h3 className="text-base font-bold text-slate-900">
                    {group.name}
                    <span className="mr-2 text-sm font-normal text-slate-400">
                      ({members.length})
                    </span>
                  </h3>
                  <button
                    onClick={() => deleteGroup(group.id)}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-absent hover:bg-red-50"
                  >
                    מחיקת קבוצה
                  </button>
                </div>

                <ul>
                  {members.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 last:border-b-0"
                    >
                      <span className="font-medium text-slate-800">
                        {p.name}
                        {p.grade && (
                          <span className="mr-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                            {p.grade}
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => removeMember(group.id, p.id)}
                        className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-red-50 hover:text-absent"
                      >
                        הסרה
                      </button>
                    </li>
                  ))}
                  {members.length === 0 && (
                    <li className="px-4 py-2.5 text-sm text-slate-400">
                      אין ילדים בקבוצה
                    </li>
                  )}
                </ul>

                {nonMembers.length > 0 && (
                  <div className="border-t border-slate-100 p-3">
                    <select
                      value=""
                      onChange={(e) => addMember(group.id, e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
                    >
                      <option value="">+ הוספת ילד/ה לקבוצה…</option>
                      {nonMembers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.grade ? ` (${p.grade})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
              אין קבוצות. אפשר לחלק את הילדים לקבוצות (א׳, ב׳, ג׳…).
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
