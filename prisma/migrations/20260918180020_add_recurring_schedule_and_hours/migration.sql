-- Wave 3, item 1: recurring schedules and per-session hours.
--
-- Additive only. Every existing Event keeps its behaviour because `kind`
-- defaults to 'camp', which is exactly what the old range+weekend-checkbox
-- model was; its days simply have no hours yet (NULL), and hoursBetween()
-- reads a NULL pair as 0 rather than guessing.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "defaultEndTime" TEXT,
ADD COLUMN     "defaultStartTime" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'camp';

-- AlterTable
ALTER TABLE "EventDay" ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "startTime" TEXT;

-- CreateTable
CREATE TABLE "EventWeekday" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "EventWeekday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventWeekday_eventId_idx" ON "EventWeekday"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventWeekday_eventId_weekday_key" ON "EventWeekday"("eventId", "weekday");

-- AddForeignKey
ALTER TABLE "EventWeekday" ADD CONSTRAINT "EventWeekday_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
