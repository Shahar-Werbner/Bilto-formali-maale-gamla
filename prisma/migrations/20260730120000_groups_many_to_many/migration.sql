-- Switch Participant↔Group from a single-group FK to many-to-many.
-- Existing memberships (each participant's current group) are preserved.

-- CreateTable: implicit m-n join table (A = Group.id, B = Participant.id)
CREATE TABLE "_GroupMembers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_GroupMembers_AB_unique" ON "_GroupMembers"("A", "B");
CREATE INDEX "_GroupMembers_B_index" ON "_GroupMembers"("B");

-- AddForeignKey
ALTER TABLE "_GroupMembers" ADD CONSTRAINT "_GroupMembers_A_fkey" FOREIGN KEY ("A") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_GroupMembers" ADD CONSTRAINT "_GroupMembers_B_fkey" FOREIGN KEY ("B") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing data: every participant's current group becomes a membership.
INSERT INTO "_GroupMembers" ("A", "B") SELECT "groupId", "id" FROM "Participant";

-- Drop the old single-group column.
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_groupId_fkey";
DROP INDEX "Participant_groupId_idx";
ALTER TABLE "Participant" DROP COLUMN "groupId";
