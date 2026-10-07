import { headers } from "next/headers";
import RegistrationForm from "@/components/RegistrationForm";
import { REGISTRATION_READ_LIMIT } from "@/lib/registration";
import {
  formChildren,
  formIsFull,
  resolveRegistrationForm,
} from "@/lib/registration-server";

// The registration form (item 8). Open, like /p/<token>: the token in the path
// is the only credential, and the link is posted to the parents' WhatsApp
// group.
//
// This page sends the list of children's names and grades to whoever holds
// the link — the project owner's decision, made knowing that cost. What keeps
// it to that: name and grade only, nothing about contacts or pickup; the list
// is only sent while the form is open; and the read is throttled like a write.

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

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

export default async function RegistrationPage({
  params,
}: {
  params: { token: string };
}) {
  const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (REGISTRATION_READ_LIMIT.check(ip)) {
    return (
      <DeadEnd
        title="יותר מדי כניסות"
        body="נסו לפתוח את הקישור שוב בעוד כמה דקות."
      />
    );
  }

  const resolved = await resolveRegistrationForm(params.token);

  if (resolved.state === "unknown") {
    return (
      <DeadEnd
        title="הקישור לא נמצא"
        body="ייתכן שהקישור הועתק חלקית, או שהצוות החליף אותו בקישור חדש. כדאי לבדוק בקבוצה אם נשלח קישור חדש."
      />
    );
  }
  if (resolved.state !== "open") {
    // No form and no list of children: a closed form sends nothing.
    return (
      <DeadEnd
        title={resolved.state === "draft" ? "ההרשמה עוד לא נפתחה" : "ההרשמה נסגרה"}
        body={
          resolved.state === "draft"
            ? `ההרשמה ל${resolved.eventName} עוד לא נפתחה.`
            : `ההרשמה ל${resolved.eventName} נסגרה. לשאלות אפשר לפנות לצוות.`
        }
      />
    );
  }

  const [children, full] = await Promise.all([
    formChildren(),
    formIsFull(resolved.form),
  ]);
  // Only what the form shows goes to the browser.
  const f = resolved.form;

  return (
    <Shell>
      <RegistrationForm
        token={params.token}
        form={{
          eventName: f.eventName,
          intro: f.intro,
          price: f.price,
          closesAt: f.closesAt,
          equipment: f.equipment,
          equipmentUpdated: f.equipmentUpdated,
          days: f.days,
        }}
        roster={children}
        full={full}
      />
    </Shell>
  );
}
