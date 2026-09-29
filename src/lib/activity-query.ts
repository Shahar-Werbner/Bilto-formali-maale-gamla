import { prisma } from "@/lib/prisma";
import { LIVE_ACTIVITY } from "@/lib/event-scope";
import { summarizeRatings, rankActivities, type RatingSummary } from "@/lib/activities";

export type BankActivity = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number | null;
  materials: string | null;
  tags: string[];
  minGrade: string | null;
  maxGrade: string | null;
  archived: boolean;
  summary: RatingSummary;
  /** Approved slots on live events that used it — "scheduled 6 times". */
  timesUsed: number;
  /** The last few verdicts that came with words, newest first. */
  notes: { verdict: string; note: string; at: string }[];
};

const NOTES_PER_ACTIVITY = 3;

// The bank, ranked by what worked. One query for the rows and their ratings;
// the ranking is a calculation over them (src/lib/activities.ts), not SQL.
//
// Ratings and uses are counted only where the slot's event still exists (or
// the slot itself is gone — a rating outlives its slot on purpose). A deleted
// event disappears from every report, and the bank is one.
export async function loadBank({
  archived = false,
}: { archived?: boolean } = {}): Promise<BankActivity[]> {
  const liveRun = {
    OR: [{ activitySlotId: null }, { activitySlot: { eventDay: { event: { deletedAt: null } } } }],
  };
  const rows = await prisma.activity.findMany({
    where: archived ? { deletedAt: { not: null } } : LIVE_ACTIVITY,
    include: {
      ratings: {
        where: liveRun,
        select: { verdict: true, note: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      },
      _count: {
        // Approved slots only: a proposal nobody signed off was not a use.
        select: {
          slots: { where: { status: "approved", eventDay: { event: { deletedAt: null } } } },
        },
      },
    },
  });

  return rankActivities(
    rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      durationMinutes: a.durationMinutes,
      materials: a.materials,
      tags: a.tags,
      minGrade: a.minGrade,
      maxGrade: a.maxGrade,
      archived: a.deletedAt !== null,
      summary: summarizeRatings(a.ratings),
      timesUsed: a._count.slots,
      notes: a.ratings
        .filter((r) => r.note)
        .slice(0, NOTES_PER_ACTIVITY)
        .map((r) => ({ verdict: r.verdict, note: r.note as string, at: r.updatedAt.toISOString() })),
    })),
  );
}
