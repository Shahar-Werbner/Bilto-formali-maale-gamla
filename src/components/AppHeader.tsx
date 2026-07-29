import Link from "next/link";
import SignOutButton from "./SignOutButton";

const NAV = [
  { href: "/events", label: "אירועים" },
  { href: "/roster", label: "קבוצות" },
  { href: "/history", label: "היסטוריה" },
];

export default function AppHeader({
  active,
  userName,
}: {
  active: string;
  userName?: string | null;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                active === item.href
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {userName && (
            <span className="hidden text-sm text-slate-500 sm:inline">
              {userName}
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
