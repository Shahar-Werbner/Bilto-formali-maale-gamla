import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import AppHeader from "@/components/AppHeader";
import EventBoard from "@/components/EventBoard";
import { formatDateOnly, sortByGrade } from "@/lib/attendance";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: {
      participants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      days: { orderBy: { date: "asc" } },
    },
  });

  if (!event) notFound();

  const data = {
    id: event.id,
    name: event.name,
    participants: sortByGrade(
      event.participants.map((p) => ({
        id: p.id,
        name: p.name,
        grade: p.grade,
      })),
    ),
    days: event.days.map((d) => ({
      id: d.id,
      date: formatDateOnly(d.date),
      description: d.description,
    })),
  };

  return (
    <>
      <AppHeader active="/events" userName={session?.user?.name} />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <EventBoard event={data} />
      </main>
    </>
  );
}
