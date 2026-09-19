import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sortByGrade } from "@/lib/attendance";
import AppHeader from "@/components/AppHeader";
import NewEventForm from "@/components/NewEventForm";
import { redirect } from "next/navigation";
import { sessionCapabilities } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// The POST behind this form requires event:edit; without it the page would
// render a form that can only fail. Send them back to the list instead.
export default async function NewEventPage() {
  const session = await auth();
  if (!(await sessionCapabilities()).includes("event:edit")) redirect("/events");

  const rows = await prisma.participant.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, grade: true },
  });
  const participants = sortByGrade(rows);

  return (
    <>
      <AppHeader
        active="/events"
        userName={session?.user?.name}
        isAdmin={session?.user?.role === "admin"}
      />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <h1 className="mb-4 text-xl font-bold text-slate-900">אירוע חדש</h1>
        <NewEventForm participants={participants} />
      </main>
    </>
  );
}
