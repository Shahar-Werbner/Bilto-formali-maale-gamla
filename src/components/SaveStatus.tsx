"use client";

// Tells the user the truth about their taps: saved, waiting, or not connected.
// Without this the queue would be invisible, and someone could walk away from
// a day's attendance that never left the phone.
export default function SaveStatus({
  pending,
  online,
}: {
  pending: number;
  online: boolean;
}) {
  if (pending === 0 && online) {
    return (
      <span className="text-xs font-semibold text-present">✓ נשמר</span>
    );
  }
  if (!online) {
    return (
      <span className="rounded-md bg-late/10 px-2 py-1 text-xs font-semibold text-late">
        אין חיבור · {pending > 0 ? `${pending} ממתינים` : "הסימונים יישמרו"}
      </span>
    );
  }
  return (
    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
      שומר… ({pending})
    </span>
  );
}
