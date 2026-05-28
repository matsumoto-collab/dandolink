/*
  Warnings:

  - You are about to drop the column `projectId` on the `Estimate` table. All the data in the column will be lost.
  - You are about to drop the column `projectId` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the `Project` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `projectMasterId` to the `Invoice` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Estimate_projectId_idx";

-- DropIndex
DROP INDEX "Invoice_projectId_idx";

-- AlterTable
ALTER TABLE "Estimate" DROP COLUMN "projectId",
ADD COLUMN     "projectMasterId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "projectId",
ADD COLUMN     "projectMasterId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "teamId" TEXT,
ALTER COLUMN "role" SET DEFAULT 'manager';

-- DropTable
DROP TABLE "Project";

-- CreateTable
CREATE TABLE "ProjectMaster" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customer" TEXT,
    "constructionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "location" TEXT,
    "description" TEXT,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "assignedEmployeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "workers" TEXT,
    "vehicles" TEXT,
    "meetingTime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "confirmedWorkerIds" TEXT,
    "confirmedVehicleIds" TEXT,
    "isDispatchConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manager" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "totalMembers" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitPriceMaster" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "templates" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitPriceMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyInfo" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "tel" TEXT NOT NULL,
    "fax" TEXT,
    "email" TEXT,
    "representative" TEXT NOT NULL,
    "sealImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarRemark" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarRemark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationRecord" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "employeeIds" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayedForemanIds" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMaster_title_idx" ON "ProjectMaster"("title");

-- CreateIndex
CREATE INDEX "ProjectMaster_customer_idx" ON "ProjectMaster"("customer");

-- CreateIndex
CREATE INDEX "ProjectMaster_status_idx" ON "ProjectMaster"("status");

-- CreateIndex
CREATE INDEX "ProjectMaster_createdAt_idx" ON "ProjectMaster"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectAssignment_projectMasterId_idx" ON "ProjectAssignment"("projectMasterId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_assignedEmployeeId_idx" ON "ProjectAssignment"("assignedEmployeeId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_date_idx" ON "ProjectAssignment"("date");

-- CreateIndex
CREATE INDEX "ProjectAssignment_isDispatchConfirmed_idx" ON "ProjectAssignment"("isDispatchConfirmed");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAssignment_projectMasterId_assignedEmployeeId_date_key" ON "ProjectAssignment"("projectMasterId", "assignedEmployeeId", "date");

-- CreateIndex
CREATE INDEX "Vehicle_name_idx" ON "Vehicle"("name");

-- CreateIndex
CREATE INDEX "Worker_name_idx" ON "Worker"("name");

-- CreateIndex
CREATE INDEX "Manager_name_idx" ON "Manager"("name");

-- CreateIndex
CREATE INDEX "UnitPriceMaster_description_idx" ON "UnitPriceMaster"("description");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarRemark_dateKey_key" ON "CalendarRemark"("dateKey");

-- CreateIndex
CREATE INDEX "CalendarRemark_dateKey_idx" ON "CalendarRemark"("dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "VacationRecord_dateKey_key" ON "VacationRecord"("dateKey");

-- CreateIndex
CREATE INDEX "VacationRecord_dateKey_idx" ON "VacationRecord"("dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "UserSettings_userId_idx" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "Estimate_projectMasterId_idx" ON "Estimate"("projectMasterId");

-- CreateIndex
CREATE INDEX "Invoice_projectMasterId_idx" ON "Invoice"("projectMasterId");

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "ProjectMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
