-- AlterTable
ALTER TABLE "EventDay" ADD COLUMN     "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ExpectedAttendance" ADD COLUMN     "bringsFood" BOOLEAN;

-- CreateTable
CREATE TABLE "RegistrationForm" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "intro" TEXT,
    "price" TEXT,
    "capacity" INTEGER,
    "autoApprove" BOOLEAN NOT NULL DEFAULT true,
    "openedAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "equipmentUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "participantId" TEXT,
    "childName" TEXT,
    "childGrade" TEXT,
    "parentName" TEXT NOT NULL,
    "parentPhone" TEXT NOT NULL,
    "dismissal" TEXT NOT NULL,
    "pickupName" TEXT,
    "pickupRelation" TEXT,
    "pickupPhone" TEXT,
    "note" TEXT,
    "equipmentAck" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "reviewReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationDay" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "eventDayId" TEXT NOT NULL,
    "coming" BOOLEAN NOT NULL,
    "bringsFood" BOOLEAN,

    CONSTRAINT "RegistrationDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationForm_eventId_key" ON "RegistrationForm"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationForm_token_key" ON "RegistrationForm"("token");

-- CreateIndex
CREATE INDEX "Registration_formId_status_idx" ON "Registration"("formId", "status");

-- CreateIndex
CREATE INDEX "Registration_participantId_idx" ON "Registration"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_formId_participantId_key" ON "Registration"("formId", "participantId");

-- CreateIndex
CREATE INDEX "RegistrationDay_eventDayId_idx" ON "RegistrationDay"("eventDayId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationDay_registrationId_eventDayId_key" ON "RegistrationDay"("registrationId", "eventDayId");

-- AddForeignKey
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationDay" ADD CONSTRAINT "RegistrationDay_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationDay" ADD CONSTRAINT "RegistrationDay_eventDayId_fkey" FOREIGN KEY ("eventDayId") REFERENCES "EventDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
