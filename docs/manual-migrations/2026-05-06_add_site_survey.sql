-- CreateTable
CREATE TABLE "public"."SiteSurvey" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT,
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "workType" TEXT,
    "managerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduledDate" TIMESTAMP(3),
    "notes" TEXT,
    "handoffNotes" TEXT,
    "arrivalTime" TEXT,
    "vehicleSpec" TEXT,
    "drawingData" JSONB NOT NULL,
    "scaffoldSpec" JSONB,
    "surroundings" JSONB,
    "perimeter" DOUBLE PRECISION,
    "floorArea" DOUBLE PRECISION,
    "scaffoldArea" DOUBLE PRECISION,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SiteSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteSurvey_projectMasterId_idx" ON "public"."SiteSurvey"("projectMasterId");

-- CreateIndex
CREATE INDEX "SiteSurvey_createdAt_idx" ON "public"."SiteSurvey"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."SiteSurvey" ADD CONSTRAINT "SiteSurvey_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
