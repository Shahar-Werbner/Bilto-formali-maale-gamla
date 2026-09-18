import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import RosterManager from "@/components/RosterManager";

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const session = await auth();

  const [participants, groups] = await Promise.all([
    prisma.participant.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, grade: true },
    }),
    prisma.group.findMany({
      orderBy: { createdAt: "asc" },
      include: { participants: { select: { id: true } } },
    }),
  ]);

  const plainGroups = groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberIds: g.participants.map((p) => p.id),
  }));

  return (
    <>
      <AppHeader active="/roster" userName={session?.user?.name} />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <RosterManager
          initialParticipants={participants}
          initialGroups={plainGroups}
        />
      </main>
    </>
  );
}
