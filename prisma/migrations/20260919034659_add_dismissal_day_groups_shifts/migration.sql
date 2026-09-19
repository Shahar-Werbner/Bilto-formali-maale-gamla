-- Wave 3, schema session for items 2, 3 and 4: dismissal, per-session groups
-- and staff shifts. Landed together so the three items can then be built in
-- parallel without any of them touching prisma/ (invariant 3).
--
-- Additive only: four new tables and one new column. Nothing is dropped and no
-- existing row changes meaning.
--
-- `Participant.defaultDismissal` defaults to 'escort' deliberately. A child with
-- no instruction recorded waits for an adult; the unsafe direction must never
-- be the one you get by forgetting to fill something in.

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "defaultDismissal" TEXT NOT NULL DEFAULT 'escort';

-- CreateTable
CREATE TABLE "PickupAuthorization" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "relation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dismissal" (
    "id" TEXT NOT NULL,
    "eventDayId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "pickedUpByName" TEXT,
    "at" TIMESTAMP(3),
    "note" TEXT,
    "markedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayGroupAssignment" (
    "id" TEXT NOT NULL,
    "eventDayId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayGroupAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventDayId" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "role" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PickupAuthorization_participantId_idx" ON "PickupAuthorization"("participantId");

-- CreateIndex
CREATE INDEX "Dismissal_eventDayId_idx" ON "Dismissal"("eventDayId");

-- CreateIndex
CREATE INDEX "Dismissal_participantId_idx" ON "Dismissal"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Dismissal_eventDayId_participantId_key" ON "Dismissal"("eventDayId", "participantId");

-- CreateIndex
CREATE INDEX "DayGroupAssignment_eventDayId_idx" ON "DayGroupAssignment"("eventDayId");

-- CreateIndex
CREATE INDEX "DayGroupAssignment_groupId_idx" ON "DayGroupAssignment"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DayGroupAssignment_eventDayId_participantId_key" ON "DayGroupAssignment"("eventDayId", "participantId");

-- CreateIndex
CREATE INDEX "Shift_eventDayId_idx" ON "Shift"("eventDayId");

-- CreateIndex
CREATE INDEX "Shift_userId_idx" ON "Shift"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_userId_eventDayId_key" ON "Shift"("userId", "eventDayId");

-- AddForeignKey
ALTER TABLE "PickupAuthorization" ADD CONSTRAINT "PickupAuthorization_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dismissal" ADD CONSTRAINT "Dismissal_eventDayId_fkey" FOREIGN KEY ("eventDayId") REFERENCES "EventDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dismissal" ADD CONSTRAINT "Dismissal_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dismissal" ADD CONSTRAINT "Dismissal_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayGroupAssignment" ADD CONSTRAINT "DayGroupAssignment_eventDayId_fkey" FOREIGN KEY ("eventDayId") REFERENCES "EventDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayGroupAssignment" ADD CONSTRAINT "DayGroupAssignment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayGroupAssignment" ADD CONSTRAINT "DayGroupAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_eventDayId_fkey" FOREIGN KEY ("eventDayId") REFERENCES "EventDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
