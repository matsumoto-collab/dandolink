/*
  Warnings:

  - You are about to drop the column `customer` on the `ProjectMaster` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "ProjectMaster_customer_idx";

-- AlterTable
ALTER TABLE "ProjectMaster" DROP COLUMN "customer",
ADD COLUMN     "area" DOUBLE PRECISION,
ADD COLUMN     "areaRemarks" TEXT,
ADD COLUMN     "assemblyDate" TIMESTAMP(3),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "constructionContent" TEXT,
ADD COLUMN     "contractAmount" INTEGER,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "demolitionDate" TIMESTAMP(3),
ADD COLUMN     "estimatedAssemblyWorkers" INTEGER,
ADD COLUMN     "estimatedDemolitionWorkers" INTEGER,
ADD COLUMN     "plusCode" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "prefecture" TEXT,
ADD COLUMN     "scaffoldingSpec" JSONB,
ALTER COLUMN "constructionType" SET DEFAULT 'other';

-- CreateIndex
CREATE INDEX "ProjectMaster_customerId_idx" ON "ProjectMaster"("customerId");

-- CreateIndex
CREATE INDEX "ProjectMaster_customerName_idx" ON "ProjectMaster"("customerName");
