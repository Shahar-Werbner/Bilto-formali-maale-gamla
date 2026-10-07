import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import RegistrationManager from "@/components/RegistrationManager";
import { sessionCapabilities } from "@/lib/api-auth";
import { formatDateOnly } from "@/lib/attendance";
import { liveEvent } from "@/lib/event-scope";
import { dateToIsraelLocal, formState } from "@/lib/registration";
import { staffRegistrations } from "@/lib/registration-server";
import { registrationOverview } from "@/lib/registration-overview-server";
import RegistrationOverview from "@/components/RegistrationOverview";

// The event's registration, for the staff (item 8). An adult with
// registration:manage gets everything: the overview, the link, what is
// waiting for approval, and the settings. Anyone else who can see the event —
// a youth counselor — gets the overview only, once the link is out: who
// registered, food per day, who has not answered. Never a parent's name or
// phone: those columns are not even read without roster:contacts.

export const dynamic = "force-dynamic";

export default async function EventRegistrationPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const capabilities = await sessionCapabilities();
  const canManage = capabilities.includes("registration:manage");
  if (!canManage && !capabilities.includes("event:view")) redirect("/events");
  const withContacts = capabilities.includes("roster:contacts");

  const event = await prisma.event.findFirst({
    where: liveEvent(params.id),
    select: {
      id: true,
      name: true,
      kind: true,
      startDate: true,
      endDate: true,
      registration: true,
      days: {
        orderBy: { date: "asc" },
        select: { id: true, date: true, startTime: true, endTime: true, equipment: true },
      },
    },
  });
  if (!event) notFound();

  const form = event.registration;
  // Without the right to manage it, there is nothing to see before the link
  // is sent — and the settings and the link itself are an adult's.
  if (!canManage && !form?.openedAt) redirect(`/events/${params.id}`);

  const [registrations, overview] = await Promise.all([
    form && canManage ? staffRegistrations(form.id, { withContacts }) : [],
    form?.openedAt ? registrationOverview(event, form.id, { withContacts }) : null,
  ]);
  const overviewNode = overview && <RegistrationOverview eventName={event.name} data={overview} />;

  return (
    <>
      <AppHeader
        active="/events"
        userName={session?.user?.name}
        isAdmin={session?.user?.role === "admin"}
      />
      <main className="mx-auto max-w-3xl px-4 py-4">
        {!canManage ? (
          <div className="flex flex-col gap-4">
            <div>
              <a href={`/events/${event.id}`} className="text-sm text-slate-500 underline">
                → חזרה לאירוע
              </a>
              <h1 className="mt-1 text-xl font-bold text-slate-900">הרשמה · {event.name}</h1>
            </div>
            {overviewNode}
          </div>
        ) : (
          <RegistrationManager
            event={{
              id: event.id,
              name: event.name,
              kind: event.kind === "recurring" ? "recurring" : "camp",
              days: event.days.map((d) => ({
                id: d.id,
                date: formatDateOnly(d.date),
                startTime: d.startTime,
                endTime: d.endTime,
                equipment: d.equipment,
              })),
            }}
            form={
              form && {
                token: form.token,
                state: formState(form),
                intro: form.intro,
                price: form.price,
                capacity: form.capacity,
                autoApprove: form.autoApprove,
                closesAt: form.closesAt ? dateToIsraelLocal(form.closesAt) : "",
                equipment: form.equipment,
              }
            }
            registrations={registrations}
            canApplyContact={withContacts}
            overview={overviewNode}
          />
        )}
      </main>
    </>
  );
}
