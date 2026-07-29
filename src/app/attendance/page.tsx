import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import AttendanceBoard from "@/components/AttendanceBoard";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const session = await auth();

  const groups = await prisma.group.findMany({
    orderBy: { createdAt: "asc" },
    include: { participants: { orderBy: { createdAt: "asc" } } },
  });

  const plain = groups.map((g) => ({
    id: g.id,
    name: g.name,
    participants: g.participants.map((p) => ({ id: p.id, name: p.name })),
  }));

  return (
    <>
      <AppHeader active="/attendance" userName={session?.user?.name} />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <AttendanceBoard groups={plain} />
      </main>
    </>
  );
}
