-- CreateTable
CREATE TABLE "ParentLink" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpectedAttendance" (
    "id" TEXT NOT NULL,
    "eventDayId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "coming" BOOLEAN NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpectedAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParentLink_token_key" ON "ParentLink"("token");

-- CreateIndex
CREATE INDEX "ParentLink_participantId_idx" ON "ParentLink"("participantId");

-- CreateIndex
CREATE INDEX "ExpectedAttendance_eventDayId_idx" ON "ExpectedAttendance"("eventDayId");

-- CreateIndex
CREATE INDEX "ExpectedAttendance_participantId_idx" ON "ExpectedAttendance"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedAttendance_eventDayId_participantId_key" ON "ExpectedAttendance"("eventDayId", "participantId");

-- AddForeignKey
ALTER TABLE "ParentLink" ADD CONSTRAINT "ParentLink_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedAttendance" ADD CONSTRAINT "ExpectedAttendance_eventDayId_fkey" FOREIGN KEY ("eventDayId") REFERENCES "EventDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedAttendance" ADD CONSTRAINT "ExpectedAttendance_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
