"use client";

import { useState } from "react";

type Participant = { id: string; name: string; grade?: string | null };
type Group = { id: string; name: string; participants: Participant[] };

export default function RosterManager({
  initialGroups,
}: {
  initialGroups: Group[];
}) {
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const group = await res.json();
      setGroups((g) => [...g, { ...group, participants: [] }]);
      setNewGroupName("");
    } catch {
      setError("הוספת הקבוצה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(id: string) {
    if (!confirm("למחוק את הקבוצה וכל המשתתפים שלה?")) return;
    const prev = groups;
    setGroups((g) => g.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setGroups(prev);
      setError("מחיקת הקבוצה נכשלה");
    }
  }

  async function addParticipant(groupId: string, name: string, grade: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, grade: grade.trim(), groupId }),
      });
      if (!res.ok) throw new Error();
      const participant = await res.json();
      setGroups((g) =>
        g.map((grp) =>
          grp.id === groupId
            ? { ...grp, participants: [...grp.participants, participant] }
            : grp,
        ),
      );
    } catch {
      setError("הוספת המשתתף נכשלה");
    }
  }

  async function updateGrade(groupId: string, id: string, grade: string) {
    const prev = groups;
    const value = grade.trim() || null;
    setGroups((g) =>
      g.map((grp) =>
        grp.id === groupId
          ? {
              ...grp,
              participants: grp.participants.map((p) =>
                p.id === id ? { ...p, grade: value } : p,
              ),
            }
          : grp,
      ),
    );
    try {
      const res = await fetch(`/api/participants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: grade.trim() }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setGroups(prev);
      setError("עדכון הכיתה נכשל");
    }
  }

  async function deleteParticipant(groupId: string, id: string) {
    const prev = groups;
    setGroups((g) =>
      g.map((grp) =>
        grp.id === groupId
          ? { ...grp, participants: grp.participants.filter((p) => p.id !== id) }
          : grp,
      ),
    );
    try {
      const res = await fetch(`/api/participants/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setGroups(prev);
      setError("מחיקת המשתתף נכשלה");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={addGroup}
        className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-4"
      >
        <input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="שם קבוצה חדשה"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-3 text-base"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          הוספה
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
          אין עדיין קבוצות. הוסיפו קבוצה ראשונה למעלה.
        </p>
      )}

      {groups.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          onDeleteGroup={() => deleteGroup(group.id)}
          onAddParticipant={(name, grade) =>
            addParticipant(group.id, name, grade)
          }
          onUpdateGrade={(id, grade) => updateGrade(group.id, id, grade)}
          onDeleteParticipant={(id) => deleteParticipant(group.id, id)}
        />
      ))}
    </div>
  );
}

function GroupCard({
  group,
  onDeleteGroup,
  onAddParticipant,
  onUpdateGrade,
  onDeleteParticipant,
}: {
  group: Group;
  onDeleteGroup: () => void;
  onAddParticipant: (name: string, grade: string) => void;
  onUpdateGrade: (id: string, grade: string) => void;
  onDeleteParticipant: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onAddParticipant(name, grade);
    setName("");
    setGrade("");
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-lg font-bold text-slate-900">
          {group.name}
          <span className="mr-2 text-sm font-normal text-slate-400">
            ({group.participants.length})
          </span>
        </h2>
        <button
          onClick={onDeleteGroup}
          className="rounded-lg px-3 py-2 text-sm font-medium text-absent hover:bg-red-50"
        >
          מחיקת קבוצה
        </button>
      </div>

      <ul>
        {group.participants.map((p, i) => (
          <li
            key={p.id}
            className={`flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 last:border-b-0 ${
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
                  onUpdateGrade(p.id, e.target.value);
                }
              }}
              placeholder="כיתה"
              className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm"
            />
            <button
              onClick={() => onDeleteParticipant(p.id)}
              className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-red-50 hover:text-absent"
              aria-label={`מחיקת ${p.name}`}
            >
              מחיקה
            </button>
          </li>
        ))}
        {group.participants.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-400">אין משתתפים עדיין</li>
        )}
      </ul>

      <form
        onSubmit={submit}
        className="flex gap-2 border-t border-slate-100 p-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם משתתף/ת"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <input
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          placeholder="כיתה"
          className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-center text-base"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-100 px-4 py-2 font-semibold text-slate-800 hover:bg-slate-200"
        >
          הוספה
        </button>
      </form>
    </section>
  );
}
