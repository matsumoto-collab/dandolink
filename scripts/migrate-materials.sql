-- 材料管理テーブル作成

CREATE TABLE IF NOT EXISTS "public"."MaterialCategory" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."MaterialItem" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT,
    "unit" TEXT NOT NULL DEFAULT '本',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."MaterialRequisition" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "foremanId" TEXT NOT NULL,
    "foremanName" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '出庫',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "vehicleInfo" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialRequisition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."MaterialRequisitionItem" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "vehicleLabel" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaterialRequisitionItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "MaterialCategory_name_idx" ON "public"."MaterialCategory"("name");
CREATE INDEX IF NOT EXISTS "MaterialCategory_sortOrder_idx" ON "public"."MaterialCategory"("sortOrder");
CREATE INDEX IF NOT EXISTS "MaterialItem_categoryId_idx" ON "public"."MaterialItem"("categoryId");
CREATE INDEX IF NOT EXISTS "MaterialItem_sortOrder_idx" ON "public"."MaterialItem"("sortOrder");
CREATE INDEX IF NOT EXISTS "MaterialRequisition_projectMasterId_idx" ON "public"."MaterialRequisition"("projectMasterId");
CREATE INDEX IF NOT EXISTS "MaterialRequisition_date_idx" ON "public"."MaterialRequisition"("date");
CREATE INDEX IF NOT EXISTS "MaterialRequisition_foremanId_idx" ON "public"."MaterialRequisition"("foremanId");
CREATE INDEX IF NOT EXISTS "MaterialRequisition_status_idx" ON "public"."MaterialRequisition"("status");
CREATE INDEX IF NOT EXISTS "MaterialRequisitionItem_requisitionId_idx" ON "public"."MaterialRequisitionItem"("requisitionId");
CREATE INDEX IF NOT EXISTS "MaterialRequisitionItem_materialItemId_idx" ON "public"."MaterialRequisitionItem"("materialItemId");

-- Foreign Keys
ALTER TABLE "public"."MaterialItem" ADD CONSTRAINT "MaterialItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."MaterialCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."MaterialRequisitionItem" ADD CONSTRAINT "MaterialRequisitionItem_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "public"."MaterialRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."MaterialRequisitionItem" ADD CONSTRAINT "MaterialRequisitionItem_materialItemId_fkey" FOREIGN KEY ("materialItemId") REFERENCES "public"."MaterialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
