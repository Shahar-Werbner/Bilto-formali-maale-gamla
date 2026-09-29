import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppHeader from "@/components/AppHeader";
import ActivityBank from "@/components/ActivityBank";
import { sessionCapabilities } from "@/lib/api-auth";
import { loadBank } from "@/lib/activity-query";

export const dynamic = "force-dynamic";

// The activity bank (item 7): what this team has run, ranked by how it went.
export default async function ActivitiesPage() {
  const session = await auth();
  const capabilities = await sessionCapabilities();
  if (!capabilities.includes("activity:view")) redirect("/events");

  const activities = await loadBank();

  return (
    <>
      <AppHeader
        active="/activities"
        userName={session?.user?.name}
        isAdmin={session?.user?.role === "admin"}
      />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <ActivityBank
          initialActivities={activities}
          canEdit={capabilities.includes("activity:edit")}
        />
      </main>
    </>
  );
}
