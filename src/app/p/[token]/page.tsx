import ParentAnswerForm from "@/components/ParentAnswerForm";
import { parentDays, resolveParentLink, touchParentLink } from "@/lib/parent-link";

// The one page in this app with no sign-in in front of it (item 5). Everything
// it shows was resolved from the token in the path, server-side; nothing about
// any other child is fetched, so nothing about any other child can leak.

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

// The two dead ends. Both are written for a parent holding a phone, not for a
// developer: they say what happened and what to do next, and neither shows an
// error code or the word "token".
function DeadEnd({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="mt-10 rounded-2xl bg-white p-6 text-center shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm leading-relaxed text-slate-600">{body}</p>
      </div>
    </Shell>
  );
}

export default async function ParentPage({
  params,
}: {
  params: { token: string };
}) {
  const link = await resolveParentLink(params.token);

  if (!link.ok) {
    return link.reason === "revoked" ? (
      <DeadEnd
        title="הקישור כבר לא פעיל"
        body="הקישור הזה הופסק. אפשר לבקש מהצוות קישור חדש."
      />
    ) : (
      <DeadEnd
        title="הקישור לא נמצא"
        body="ייתכן שהקישור הועתק חלקית. כדאי לפתוח אותו שוב מההודעה המקורית, או לבקש מהצוות קישור חדש."
      />
    );
  }

  await touchParentLink(link.linkId);
  const days = await parentDays(link.participant.id);

  return (
    <Shell>
      <header className="mb-4 mt-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900">{link.participant.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {link.participant.grade
            ? `כיתה ${link.participant.grade} · מעלה גמלא`
            : "מעלה גמלא"}
        </p>
      </header>

      {days.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm leading-relaxed text-slate-600">
            אין כרגע מפגשים קרובים. כשייקבעו מפגשים חדשים הם יופיעו כאן — אפשר
            לשמור את הקישור.
          </p>
        </div>
      ) : (
        <ParentAnswerForm token={params.token} days={days} />
      )}

      <p className="mb-8 mt-6 text-center text-xs leading-relaxed text-slate-400">
        הקישור הזה אישי לילד/ה. כדאי לא להעביר אותו הלאה.
      </p>
    </Shell>
  );
}
