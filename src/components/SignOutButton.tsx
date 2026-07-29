"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
    >
      התנתקות
    </button>
  );
}
