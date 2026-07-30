import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sortByGrade } from "@/lib/attendance";
import AppHeader from "@/components/AppHeader";
import NewEventForm from "@/components/NewEventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const session = await auth();

  const rows = await prisma.participant.findMany({
    select: { id: true, name: true, grade: true },
  });
  const participants = sortByGrade(rows);

  return (
    <>
      <AppHeader active="/events" userName={session?.user?.name} />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <h1 className="mb-4 text-xl font-bold text-slate-900">אירוע חדש</h1>
        <NewEventForm participants={participants} />
      </main>
    </>
  );
}
