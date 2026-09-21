"use client";

import { useEffect, useState } from "react";
import { parentLinkUrl } from "@/lib/parents";

type Link = {
  id: string;
  token: string;
  label: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

// The family's links, on the child's row in the roster (item 5).
//
// Two things this screen has to make easy, because they are the whole workflow:
// copying a link into a WhatsApp message, and turning one off. Everything else
// is secondary — including creating one, which happens once per family.
//
// Loaded when the row is opened, like the pickup list beside it: fifty children
// times their links is a lot of rows to fetch for a screen whose usual answer
// is "nobody opened this".
export default function ParentLinks({
  participantId,
  participantName,
}: {
  participantId: string;
  participantName: string;
}) {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  // The link has to carry the host the staff member is actually on, and only
  // the browser knows it — a value baked in at build time is how a link ends
  // up pointing at a preview deployment that is gone next week.
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/parent-links?participantId=${encodeURIComponent(participantId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setLinks(data.links ?? []);
      } catch {
        if (!cancelled) setError("טעינת הקישורים נכשלה");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [participantId]);

  async function create() {
    setError(null);
    try {
      const res = await fetch("/api/parent-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, label: label.trim() }),
      });
      if (!res.ok) throw new Error();
      const link = await res.json();
      setLinks((list) => [
        ...list,
        { ...link, revokedAt: null, lastUsedAt: null },
      ]);
      setLabel("");
    } catch {
      setError("יצירת הקישור נכשלה");
    }
  }

  async function revoke(id: string) {
    if (
      !confirm(
        `להפסיק את הקישור? מי שמחזיק בו לא יוכל יותר לעדכן הגעה של ${participantName}.`,
      )
    )
      return;
    setError(null);
    try {
      const res = await fetch(`/api/parent-links?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setLinks((list) =>
        list.map((l) =>
          l.id === id ? { ...l, revokedAt: new Date().toISOString() } : l,
        ),
      );
    } catch {
      setError("הפסקת הקישור נכשלה");
    }
  }

  async function copy(link: Link) {
    const url = parentLinkUrl(origin, link.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(link.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access is refused often enough on a phone browser that
      // failing silently would look like a dead button. Showing the link is
      // something the person can still act on.
      setError(url);
    }
  }

  const active = links.filter((l) => !l.revokedAt);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <h4 className="mb-2 text-xs font-semibold text-slate-600">
        קישור להורים
      </h4>

      {loading ? (
        <p className="text-xs text-slate-400">טוען…</p>
      ) : (
        <>
          {active.length === 0 && (
            <p className="mb-2 text-xs text-slate-500">
              אין עדיין קישור. הקישור מאפשר להורה לעדכן אם הילד/ה מגיע/ה ולכתוב
              הודעה לצוות — בלי חשבון ובלי סיסמה.
            </p>
          )}

          <ul className="mb-2 flex flex-col gap-2">
            {links.map((l) => (
              <li
                key={l.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-2 text-xs ${
                  l.revokedAt ? "bg-slate-100 text-slate-400" : "bg-slate-50"
                }`}
              >
                <span className="font-medium text-slate-700">
                  {l.label || "קישור"}
                </span>

                <span className="text-slate-400">
                  {l.revokedAt
                    ? "הופסק"
                    : l.lastUsedAt
                      ? "נפתח"
                      : // The distinction that decides what the staff member
                        // does next: a parent who never answered is a phone
                        // call, a link nobody ever opened is a message to
                        // re-send.
                        "טרם נפתח"}
                </span>

                {!l.revokedAt && (
                  <>
                    <button
                      type="button"
                      onClick={() => copy(l)}
                      className="mr-auto rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {copied === l.id ? "הועתק ✓" : "העתקת קישור"}
                    </button>
                    <button
                      type="button"
                      onClick={() => revoke(l.id)}
                      className="rounded-md px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-absent"
                    >
                      הפסקה
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="אמא / אבא"
              aria-label="למי הקישור"
              className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={create}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              קישור חדש
            </button>
            <span className="text-[11px] text-slate-400">
              אפשר קישור נפרד לכל הורה
            </span>
          </div>
        </>
      )}

      {error && (
        <p className="mt-2 break-all text-xs text-absent" dir="auto">
          {error}
        </p>
      )}
    </div>
  );
}
