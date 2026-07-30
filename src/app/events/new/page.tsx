import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import NewEventForm from "@/components/NewEventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const session = await auth();

  const groups = await prisma.group.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      participants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });

  const plain = groups.map((g) => ({
    id: g.id,
    name: g.name,
    participants: g.participants.map((p) => ({
      id: p.id,
      name: p.name,
      grade: p.grade,
    })),
  }));

  return (
    <>
      <AppHeader active="/events" userName={session?.user?.name} />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <h1 className="mb-4 text-xl font-bold text-slate-900">אירוע חדש</h1>
        <NewEventForm groups={plain} />
      </main>
    </>
  );
}
