-- Soft delete for Group, matching Event and Participant.
--
-- A group used to be just a reusable label, so removing one was harmless. Now
-- that DayGroupAssignment records which group a child was in on a given day,
-- and that row cascades on the group, a hard delete erased the past: a session
-- that had three children rendered afterwards as one, with nothing to say a
-- group had been deleted. Deleting in the present silently rewrote history.
--
-- Additive: one nullable column and its index. No data changes, and every
-- existing group stays live (deletedAt NULL = not deleted).

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Group_deletedAt_idx" ON "Group"("deletedAt");
