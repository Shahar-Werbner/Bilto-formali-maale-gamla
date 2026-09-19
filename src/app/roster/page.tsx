import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import RosterManager from "@/components/RosterManager";
import { LIVE_GROUP } from "@/lib/event-scope";

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const session = await auth();

  const [participants, groups] = await Promise.all([
    prisma.participant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        grade: true,
        parentName: true,
        parentPhone: true,
        phone: true,
      },
    }),
    prisma.group.findMany({
      where: LIVE_GROUP,
      orderBy: { createdAt: "asc" },
      include: {
        participants: { where: { deletedAt: null }, select: { id: true } },
      },
    }),
  ]);

  const plainGroups = groups.map((g) => ({
    id: g.id,
    name: g.name,
    memberIds: g.participants.map((p) => p.id),
  }));

  return (
    <>
      <AppHeader
        active="/roster"
        userName={session?.user?.name}
        isAdmin={session?.user?.role === "admin"}
      />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <RosterManager
          initialParticipants={participants}
          initialGroups={plainGroups}
          isAdmin={session?.user?.role === "admin"}
        />
      </main>
    </>
  );
}
