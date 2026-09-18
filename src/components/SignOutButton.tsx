"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-lg px-2 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:px-3"
      aria-label="התנתקות"
    >
      {/* Shortened on a phone, where four nav items already need the room. */}
      <span className="hidden sm:inline">התנתקות</span>
      <span aria-hidden className="sm:hidden">
        יציאה
      </span>
    </button>
  );
}
