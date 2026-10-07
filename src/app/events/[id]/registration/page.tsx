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

// The event's registration form, for the staff (item 8): its settings, the
// link, and what is waiting for an adult. The fuller per-event screen (who has
// not registered, food per day, copying the list) is item 8b.

export const dynamic = "force-dynamic";

export default async function EventRegistrationPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  const capabilities = await sessionCapabilities();
  if (!capabilities.includes("registration:manage")) redirect(`/events/${params.id}`);

  const event = await prisma.event.findFirst({
    where: liveEvent(params.id),
    select: {
      id: true,
      name: true,
      kind: true,
      registration: true,
      days: {
        orderBy: { date: "asc" },
        select: { id: true, date: true, startTime: true, endTime: true, equipment: true },
      },
    },
  });
  if (!event) notFound();

  const form = event.registration;
  const registrations = form
    ? await staffRegistrations(form.id, {
        withContacts: capabilities.includes("roster:contacts"),
      })
    : [];

  return (
    <>
      <AppHeader
        active="/events"
        userName={session?.user?.name}
        isAdmin={session?.user?.role === "admin"}
      />
      <main className="mx-auto max-w-3xl px-4 py-4">
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
          canApplyContact={capabilities.includes("roster:contacts")}
        />
      </main>
    </>
  );
}
