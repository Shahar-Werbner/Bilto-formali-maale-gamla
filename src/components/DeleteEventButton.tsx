"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteEventButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm(`למחוק את האירוע "${name}" וכל הנוכחות שלו?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      alert("מחיקת האירוע נכשלה");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-absent hover:bg-red-50 disabled:opacity-50"
    >
      מחיקה
    </button>
  );
}
