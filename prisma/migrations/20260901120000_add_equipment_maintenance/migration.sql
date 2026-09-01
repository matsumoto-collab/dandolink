-- 機材台帳（車両・電動工具）の整備・修理履歴と、その添付ファイル（見積書・請求書の写真）を追加する。
-- 既存データには一切触らない（列追加とテーブル追加のみ）。
-- 車両の車種・車番・車検満了日・保険は既存の VehicleSafetyProfile をそのまま再利用するため、
-- 車両側のスキーマ変更は無い。

-- 1) 電動工具を台帳として扱うための列（すべて NULL 可＝既存行はそのまま）
ALTER TABLE "public"."Tool" ADD COLUMN IF NOT EXISTS "maker" TEXT;
ALTER TABLE "public"."Tool" ADD COLUMN IF NOT EXISTS "modelNumber" TEXT;
ALTER TABLE "public"."Tool" ADD COLUMN IF NOT EXISTS "serialNumber" TEXT;
ALTER TABLE "public"."Tool" ADD COLUMN IF NOT EXISTS "purchaseDate" DATE;
ALTER TABLE "public"."Tool" ADD COLUMN IF NOT EXISTS "purchasePrice" DECIMAL(12,2);

-- 2) 整備・修理履歴（1件 = 1回の入庫）
CREATE TABLE IF NOT EXISTS "public"."EquipmentMaintenanceRecord" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'repair',
    "title" TEXT NOT NULL,
    "vendor" TEXT,
    "amount" DECIMAL(12,2),
    "odometer" INTEGER,
    "nextDueDate" DATE,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EquipmentMaintenanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EquipmentMaintenanceRecord_targetType_targetId_date_idx"
    ON "public"."EquipmentMaintenanceRecord"("targetType", "targetId", "date");
CREATE INDEX IF NOT EXISTS "EquipmentMaintenanceRecord_date_idx"
    ON "public"."EquipmentMaintenanceRecord"("date");

-- 3) 履歴に添付する写真/PDF（Supabase Storage のパスと署名付きURLのキャッシュ）
CREATE TABLE IF NOT EXISTS "public"."EquipmentMaintenanceFile" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "signedUrl" TEXT,
    "signedUrlExpiresAt" TIMESTAMP(3),
    "thumbnailSignedUrl" TEXT,
    "thumbnailSignedUrlExpiresAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EquipmentMaintenanceFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EquipmentMaintenanceFile_recordId_idx"
    ON "public"."EquipmentMaintenanceFile"("recordId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EquipmentMaintenanceFile_recordId_fkey'
    ) THEN
        ALTER TABLE "public"."EquipmentMaintenanceFile"
            ADD CONSTRAINT "EquipmentMaintenanceFile_recordId_fkey"
            FOREIGN KEY ("recordId") REFERENCES "public"."EquipmentMaintenanceRecord"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
