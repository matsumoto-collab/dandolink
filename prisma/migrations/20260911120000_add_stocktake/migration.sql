-- 実地棚卸（材料管理表エクセルの置き換え）
--
-- 目的: 「大規模案件が重なったときに材料を買うか / レンタルで済ますか」を判断するために、
--       いま土場に何本余っているかを縦持ちで持てるようにする。
--
-- 追加のみ。既存テーブルの削除・型変更・データ更新は行わない。
--   1. MaterialItem.scaffoldMethod  … 工法区分（'standard' | 'lock'）の列追加。既定は 'standard' なので既存行は通常足場のまま
--   2. StorageLocation              … 置き場所（土場 / 上野）
--   3. Stocktake / StocktakeLine    … 棚卸 1 回分とその明細
--   4. 初期データ                    … 置き場所「土場」「上野」を投入（既にあれば何もしない）

-- 1. 工法区分 -----------------------------------------------------------------
ALTER TABLE "public"."MaterialItem"
    ADD COLUMN IF NOT EXISTS "scaffoldMethod" TEXT NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS "MaterialItem_scaffoldMethod_idx"
    ON "public"."MaterialItem" ("scaffoldMethod");

-- 2. 置き場所 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."StorageLocation" (
    "id"        TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name"      TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StorageLocation_sortOrder_idx"
    ON "public"."StorageLocation" ("sortOrder");

-- 3. 棚卸 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."Stocktake" (
    "id"             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "locationId"     TEXT NOT NULL,
    "scaffoldMethod" TEXT NOT NULL DEFAULT 'standard',
    "date"           TIMESTAMP(3) NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'draft',
    "notes"          TEXT,
    "createdBy"      TEXT,
    "createdByName"  TEXT NOT NULL DEFAULT '',
    "confirmedAt"    TIMESTAMP(3),
    "confirmedBy"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Stocktake_locationId_scaffoldMethod_date_key"
    ON "public"."Stocktake" ("locationId", "scaffoldMethod", "date");
CREATE INDEX IF NOT EXISTS "Stocktake_date_idx"   ON "public"."Stocktake" ("date");
CREATE INDEX IF NOT EXISTS "Stocktake_status_idx" ON "public"."Stocktake" ("status");

CREATE TABLE IF NOT EXISTS "public"."StocktakeLine" (
    "id"             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "stocktakeId"    TEXT NOT NULL,
    "materialItemId" TEXT NOT NULL,
    "quantity"       INTEGER,
    "note"           TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StocktakeLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StocktakeLine_stocktakeId_materialItemId_key"
    ON "public"."StocktakeLine" ("stocktakeId", "materialItemId");
CREATE INDEX IF NOT EXISTS "StocktakeLine_stocktakeId_idx"
    ON "public"."StocktakeLine" ("stocktakeId");
CREATE INDEX IF NOT EXISTS "StocktakeLine_materialItemId_idx"
    ON "public"."StocktakeLine" ("materialItemId");

-- 外部キー（既に張られていれば何もしない）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Stocktake_locationId_fkey') THEN
        ALTER TABLE "public"."Stocktake"
            ADD CONSTRAINT "Stocktake_locationId_fkey"
            FOREIGN KEY ("locationId") REFERENCES "public"."StorageLocation"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StocktakeLine_stocktakeId_fkey') THEN
        ALTER TABLE "public"."StocktakeLine"
            ADD CONSTRAINT "StocktakeLine_stocktakeId_fkey"
            FOREIGN KEY ("stocktakeId") REFERENCES "public"."Stocktake"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StocktakeLine_materialItemId_fkey') THEN
        ALTER TABLE "public"."StocktakeLine"
            ADD CONSTRAINT "StocktakeLine_materialItemId_fkey"
            FOREIGN KEY ("materialItemId") REFERENCES "public"."MaterialItem"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. 置き場所の初期データ -------------------------------------------------------
INSERT INTO "public"."StorageLocation" ("name", "sortOrder")
SELECT '土場', 0
WHERE NOT EXISTS (SELECT 1 FROM "public"."StorageLocation" WHERE "name" = '土場');

INSERT INTO "public"."StorageLocation" ("name", "sortOrder")
SELECT '上野', 1
WHERE NOT EXISTS (SELECT 1 FROM "public"."StorageLocation" WHERE "name" = '上野');
