-- AlterTable
ALTER TABLE "ActivitySlot" ADD COLUMN     "activityId" TEXT;

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER,
    "materials" TEXT,
    "tags" TEXT[],
    "minGrade" TEXT,
    "maxGrade" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityRating" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "activitySlotId" TEXT,
    "userId" TEXT,
    "verdict" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Activity_deletedAt_idx" ON "Activity"("deletedAt");

-- CreateIndex
CREATE INDEX "ActivityRating_activityId_idx" ON "ActivityRating"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRating_activitySlotId_userId_key" ON "ActivityRating"("activitySlotId", "userId");

-- CreateIndex
CREATE INDEX "ActivitySlot_activityId_idx" ON "ActivitySlot"("activityId");

-- AddForeignKey
ALTER TABLE "ActivitySlot" ADD CONSTRAINT "ActivitySlot_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRating" ADD CONSTRAINT "ActivityRating_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRating" ADD CONSTRAINT "ActivityRating_activitySlotId_fkey" FOREIGN KEY ("activitySlotId") REFERENCES "ActivitySlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRating" ADD CONSTRAINT "ActivityRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
