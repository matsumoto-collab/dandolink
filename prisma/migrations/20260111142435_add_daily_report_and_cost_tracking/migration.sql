-- AlterTable
ALTER TABLE "ProjectMaster" ADD COLUMN     "materialCost" DOUBLE PRECISION,
ADD COLUMN     "otherExpenses" DOUBLE PRECISION,
ADD COLUMN     "subcontractorCost" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "laborDailyRate" DOUBLE PRECISION NOT NULL DEFAULT 15000,
ADD COLUMN     "standardWorkMinutes" INTEGER NOT NULL DEFAULT 480;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "dailyRate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "foremanId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "morningLoadingMinutes" INTEGER NOT NULL DEFAULT 0,
    "eveningLoadingMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyStartMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReportWorkItem" (
    "id" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "workMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReportWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReport_foremanId_idx" ON "DailyReport"("foremanId");

-- CreateIndex
CREATE INDEX "DailyReport_date_idx" ON "DailyReport"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_foremanId_date_key" ON "DailyReport"("foremanId", "date");

-- CreateIndex
CREATE INDEX "DailyReportWorkItem_dailyReportId_idx" ON "DailyReportWorkItem"("dailyReportId");

-- CreateIndex
CREATE INDEX "DailyReportWorkItem_assignmentId_idx" ON "DailyReportWorkItem"("assignmentId");

-- AddForeignKey
ALTER TABLE "DailyReportWorkItem" ADD CONSTRAINT "DailyReportWorkItem_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReportWorkItem" ADD CONSTRAINT "DailyReportWorkItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
