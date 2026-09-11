-- 過去データCSV取込（DandoLink 導入前 2024-01〜2026-04）
--
-- 追加のみ。既存テーブルの削除・型変更・データ更新は行わない。
--   1. ProjectMaster       … isBackfilled / dataSource / isNonSite / importBatchId / externalKey(一意)
--   2. Invoice             … isBackfilled / importBatchId / externalKey(一意)
--   3. ProjectAssignment   … isBackfilled / importBatchId / externalKey(一意) / backfillInfo
--   4. RevenueAdjustment   … 顧客別・月別の売上調整（案件に紐づかない売上）
--   5. BackfillImportBatch … 取り込み 1 回分の控え（取り消しに使う）
--
-- isBackfilled は既定 false なので、既存の行はすべて「進行中のデータ」のまま。
-- externalKey は既存の行では NULL（PostgreSQL の一意制約は NULL を重複扱いしない）。

-- 1. 案件 ---------------------------------------------------------------------
ALTER TABLE "public"."ProjectMaster"
    ADD COLUMN IF NOT EXISTS "isBackfilled"  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "dataSource"    TEXT,
    ADD COLUMN IF NOT EXISTS "isNonSite"     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "importBatchId" TEXT,
    ADD COLUMN IF NOT EXISTS "externalKey"   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMaster_externalKey_key" ON "public"."ProjectMaster" ("externalKey");
CREATE INDEX IF NOT EXISTS "ProjectMaster_isBackfilled_idx"  ON "public"."ProjectMaster" ("isBackfilled");
CREATE INDEX IF NOT EXISTS "ProjectMaster_importBatchId_idx" ON "public"."ProjectMaster" ("importBatchId");

-- 2. 請求書 -------------------------------------------------------------------
ALTER TABLE "public"."Invoice"
    ADD COLUMN IF NOT EXISTS "isBackfilled"  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "importBatchId" TEXT,
    ADD COLUMN IF NOT EXISTS "externalKey"   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_externalKey_key" ON "public"."Invoice" ("externalKey");
CREATE INDEX IF NOT EXISTS "Invoice_isBackfilled_idx"  ON "public"."Invoice" ("isBackfilled");
CREATE INDEX IF NOT EXISTS "Invoice_importBatchId_idx" ON "public"."Invoice" ("importBatchId");

-- 3. 配置（作業履歴） -----------------------------------------------------------
ALTER TABLE "public"."ProjectAssignment"
    ADD COLUMN IF NOT EXISTS "isBackfilled"  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "importBatchId" TEXT,
    ADD COLUMN IF NOT EXISTS "externalKey"   TEXT,
    ADD COLUMN IF NOT EXISTS "backfillInfo"  JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectAssignment_externalKey_key" ON "public"."ProjectAssignment" ("externalKey");
CREATE INDEX IF NOT EXISTS "ProjectAssignment_isBackfilled_idx"  ON "public"."ProjectAssignment" ("isBackfilled");
CREATE INDEX IF NOT EXISTS "ProjectAssignment_importBatchId_idx" ON "public"."ProjectAssignment" ("importBatchId");

-- 4. 売上調整 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."RevenueAdjustment" (
    "id"                   TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "customerName"         TEXT NOT NULL,
    "yearMonth"            TEXT NOT NULL,
    "amountExclTax"        INTEGER NOT NULL,
    "ledgerAmountExclTax"  INTEGER,
    "invoiceAmountExclTax" INTEGER,
    "note"                 TEXT,
    "importBatchId"        TEXT,
    "externalKey"          TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RevenueAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RevenueAdjustment_externalKey_key" ON "public"."RevenueAdjustment" ("externalKey");
CREATE INDEX IF NOT EXISTS "RevenueAdjustment_yearMonth_idx"     ON "public"."RevenueAdjustment" ("yearMonth");
CREATE INDEX IF NOT EXISTS "RevenueAdjustment_importBatchId_idx" ON "public"."RevenueAdjustment" ("importBatchId");

-- 5. 取り込みバッチ -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."BackfillImportBatch" (
    "id"            TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "status"        TEXT NOT NULL DEFAULT 'applied',
    "createdBy"     TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "fileNames"     JSONB,
    "summary"       JSONB,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt"  TIMESTAMP(3),
    "rolledBackBy"  TEXT,
    CONSTRAINT "BackfillImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BackfillImportBatch_createdAt_idx" ON "public"."BackfillImportBatch" ("createdAt");
