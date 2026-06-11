-- 安全書類 Phase 2: 車両安全プロフィール + 持込機械マスター
-- 要件: docs/SAFETY_DOCUMENTS_REQUIREMENTS.md §5 Phase2 / docs/SAFETY_DOCUMENTS_PLAN.md
-- 適用: npx prisma db execute --file docs/manual-migrations/2026-06-11_add_safety_phase2_vehicle_machine.sql --schema prisma/schema.prisma

-- CreateTable: 車両安全プロフィール（Vehicle と1:1。既存の車両管理に影響なし）
CREATE TABLE "public"."VehicleSafetyProfile" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "vehicleType" TEXT,
    "registrationNumber" TEXT,
    "usage" TEXT,
    "inspectionExpiry" TIMESTAMP(3),
    "jibaisekiCompany" TEXT,
    "jibaisekiExpiry" TIMESTAMP(3),
    "insuranceCompany" TEXT,
    "insuranceExpiry" TIMESTAMP(3),
    "insurancePersonal" TEXT,
    "insuranceObjective" TEXT,
    "insurancePassenger" TEXT,
    "defaultDriverName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleSafetyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSafetyProfile_vehicleId_key" ON "public"."VehicleSafetyProfile"("vehicleId");

-- AddForeignKey
ALTER TABLE "public"."VehicleSafetyProfile" ADD CONSTRAINT "VehicleSafetyProfile_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: 持込機械マスター
CREATE TABLE "public"."Machine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "model" TEXT,
    "serialNumber" TEXT,
    "maker" TEXT,
    "capacity" TEXT,
    "ownerName" TEXT,
    "defaultOperatorName" TEXT,
    "inspectionDate" TIMESTAMP(3),
    "inspectionExpiry" TIMESTAMP(3),
    "certificateNumber" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Machine_name_idx" ON "public"."Machine"("name");
CREATE INDEX "Machine_category_idx" ON "public"."Machine"("category");
