import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import AdminPanel from "@/components/AdminPanel";
import { formatDateOnly, sortByGrade } from "@/lib/attendance";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // The nav only shows this link to admins, but the page checks for itself —
  // the link is a hint, not a guard, and the JWT role can be stale.
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (me?.role !== "admin") {
    return (
      <>
        <AppHeader
          active="/admin"
          userName={session.user.name}
          isAdmin={false}
        />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
            העמוד הזה מיועד למנהלי מערכת בלבד.
          </p>
        </main>
      </>
    );
  }

  const [users, deletedEvents, deletedParticipants] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true },
    }),
    prisma.event.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, name: true, startDate: true, deletedAt: true },
    }),
    prisma.participant.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, name: true, grade: true, deletedAt: true },
    }),
  ]);

  return (
    <>
      <AppHeader active="/admin" userName={session.user.name} isAdmin />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <AdminPanel
          currentUserId={session.user.id}
          users={users}
          deletedEvents={deletedEvents.map((e) => ({
            id: e.id,
            name: e.name,
            startDate: formatDateOnly(e.startDate),
          }))}
          deletedParticipants={sortByGrade(
            deletedParticipants.map((p) => ({
              id: p.id,
              name: p.name,
              grade: p.grade,
            })),
          )}
        />
      </main>
    </>
  );
}
