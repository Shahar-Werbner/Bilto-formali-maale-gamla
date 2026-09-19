-- The approval loop for the day's schedule (item 4, stage B).
--
-- A youth counselor plans the activity they are assigned to; an adult signs it
-- off. With nowhere to hold "waiting for approval", item 4 had to give youth
-- view-only access to the schedule, which is less than the operation wants.
--
-- DEFAULT 'approved' is what makes this safe to apply to a live schedule.
-- Without it, every slot that already exists — and every slot an adult creates
-- from now on — would become "waiting for approval" the moment this runs. For
-- someone who may edit the schedule the approval is implied by creating the
-- row; only a slot written by someone who needs sign-off is set to 'pending',
-- explicitly, by the route that writes it.
--
-- Additive: three nullable-or-defaulted columns, one index, one FK. No data
-- changes and no existing row changes meaning.

-- AlterTable
ALTER TABLE "ActivitySlot" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'approved';

-- CreateIndex
CREATE INDEX "ActivitySlot_status_idx" ON "ActivitySlot"("status");

-- AddForeignKey
ALTER TABLE "ActivitySlot" ADD CONSTRAINT "ActivitySlot_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
