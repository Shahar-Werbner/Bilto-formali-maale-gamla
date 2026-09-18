"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, code }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "ההרשמה נכשלה");
      }

      // Registered — sign in automatically.
      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (signInRes?.error) {
        // Account created but auto-login failed — send to login.
        router.push("/login");
        return;
      }
      router.push("/events");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        שם מלא
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base focus:border-slate-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        אימייל
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base focus:border-slate-500 focus:outline-none"
          dir="ltr"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        סיסמה (לפחות 8 תווים)
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base focus:border-slate-500 focus:outline-none"
          dir="ltr"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        קוד צוות
        <input
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="הקוד שקיבלת מהרכז/ת"
          className="rounded-lg border border-slate-300 px-3 py-3 text-base focus:border-slate-500 focus:outline-none"
        />
      </label>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-2 rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
      >
        {loading ? "נרשם..." : "הרשמה"}
      </button>

      <p className="text-center text-sm text-slate-500">
        כבר יש לך חשבון?{" "}
        <Link href="/login" className="font-semibold text-slate-900 underline">
          התחברות
        </Link>
      </p>
    </form>
  );
}
