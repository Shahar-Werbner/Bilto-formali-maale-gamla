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
    if (
      !confirm(
        `למחוק את האירוע "${name}"? הנוכחות נשמרת, ואפשר לשחזר דרך מסך הניהול.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "מחיקת האירוע נכשלה");
      }
      router.refresh();
    } catch (err) {
      alert((err as Error).message);
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
