-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "parentName" TEXT,
ADD COLUMN     "parentPhone" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE INDEX "Event_deletedAt_idx" ON "Event"("deletedAt");

-- CreateIndex
CREATE INDEX "EventAttendance_participantId_idx" ON "EventAttendance"("participantId");

-- CreateIndex
CREATE INDEX "EventDay_date_idx" ON "EventDay"("date");

-- CreateIndex
CREATE INDEX "Participant_deletedAt_idx" ON "Participant"("deletedAt");

-- Data migration: every account in the live database was created before roles
-- were enforced, so they are all "staff". Deploying the enforcement without
-- this would leave the system with no admin at all — nobody could delete an
-- event, and nobody could promote anyone either. Promote the earliest account
-- (the one the team was set up with); further admins are added from /admin.
UPDATE "User"
SET "role" = 'admin'
WHERE "id" = (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM "User" WHERE "role" = 'admin');
