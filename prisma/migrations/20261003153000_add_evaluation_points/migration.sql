-- 評価ポイント（試行版）
--
-- 目的: 「早く終わって追加の現場に行った」「他の班を手伝った」「洗車をした」などの行動を
--       点数表（項目と点数）にもとづいて1件ずつ記録し、人ごとに合計できるようにする。
--
-- 追加のみ。既存テーブルの削除・型変更・データ更新は行わない（出勤簿 AttendanceRecord にも触らない）。
--   1. EvaluationPointItem     … 点数表の項目
--   2. EvaluationPointRate     … 項目の点数の履歴（適用開始日つき・追記のみ）
--   3. EvaluationPointRecord   … ポイントの記録（1人・1日・1項目で1行。点数は付けた時点の写し）
--   4. EvaluationPointLog      … 操作の履歴（追記のみ）
--   5. EvaluationPointSetting  … 公開の設定（1行だけ）と、その初期行
-- 5つとも、行ごとの鍵（RLS）を有効にする（いちばん下。ポリシーは作らない）。
-- 何度流しても同じ結果になる。

-- 1. 項目 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."EvaluationPointItem" (
    "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "inputBy"     TEXT NOT NULL DEFAULT 'foreman',
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdBy"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationPointItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EvaluationPointItem_sortOrder_idx"
    ON "public"."EvaluationPointItem" ("sortOrder");

-- 2. 点数の履歴 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."EvaluationPointRate" (
    "id"            TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "itemId"        TEXT NOT NULL,
    "points"        INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdBy"     TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationPointRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EvaluationPointRate_itemId_effectiveFrom_idx"
    ON "public"."EvaluationPointRate" ("itemId", "effectiveFrom");

-- 3. 記録 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."EvaluationPointRecord" (
    "id"              TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "userId"          TEXT NOT NULL,
    "date"            DATE NOT NULL,
    "itemId"          TEXT NOT NULL,
    "itemName"        TEXT NOT NULL,
    "points"          INTEGER NOT NULL,
    "rateId"          TEXT,
    "status"          TEXT NOT NULL DEFAULT 'confirmed',
    "source"          TEXT NOT NULL DEFAULT 'attendance',
    "foremanId"       TEXT,
    "note"            TEXT,
    "createdBy"       TEXT NOT NULL,
    "createdByName"   TEXT NOT NULL DEFAULT '',
    "confirmedBy"     TEXT,
    "confirmedByName" TEXT,
    "confirmedAt"     TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationPointRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EvaluationPointRecord_userId_date_itemId_key"
    ON "public"."EvaluationPointRecord" ("userId", "date", "itemId");
CREATE INDEX IF NOT EXISTS "EvaluationPointRecord_date_idx"
    ON "public"."EvaluationPointRecord" ("date");
CREATE INDEX IF NOT EXISTS "EvaluationPointRecord_userId_date_idx"
    ON "public"."EvaluationPointRecord" ("userId", "date");
CREATE INDEX IF NOT EXISTS "EvaluationPointRecord_itemId_idx"
    ON "public"."EvaluationPointRecord" ("itemId");
CREATE INDEX IF NOT EXISTS "EvaluationPointRecord_status_idx"
    ON "public"."EvaluationPointRecord" ("status");

-- 4. 操作の履歴 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."EvaluationPointLog" (
    "id"           TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "action"       TEXT NOT NULL,
    "actorId"      TEXT NOT NULL,
    "actorName"    TEXT NOT NULL DEFAULT '',
    "targetUserId" TEXT,
    "itemId"       TEXT,
    "recordId"     TEXT,
    "recordDate"   DATE,
    "detail"       JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationPointLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EvaluationPointLog_createdAt_idx"
    ON "public"."EvaluationPointLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "EvaluationPointLog_targetUserId_recordDate_idx"
    ON "public"."EvaluationPointLog" ("targetUserId", "recordDate");

-- 5. 公開の設定 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."EvaluationPointSetting" (
    "id"            TEXT NOT NULL DEFAULT 'default',
    "showToMembers" BOOLEAN NOT NULL DEFAULT false,
    "memberNotice"  TEXT,
    "updatedBy"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationPointSetting_pkey" PRIMARY KEY ("id")
);

-- 外部キー（既に張られていれば何もしない）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EvaluationPointRate_itemId_fkey') THEN
        ALTER TABLE "public"."EvaluationPointRate"
            ADD CONSTRAINT "EvaluationPointRate_itemId_fkey"
            FOREIGN KEY ("itemId") REFERENCES "public"."EvaluationPointItem"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EvaluationPointRecord_itemId_fkey') THEN
        ALTER TABLE "public"."EvaluationPointRecord"
            ADD CONSTRAINT "EvaluationPointRecord_itemId_fkey"
            FOREIGN KEY ("itemId") REFERENCES "public"."EvaluationPointItem"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 公開の設定の初期行（本人には見せない状態で始める。既にあれば何もしない）
INSERT INTO "public"."EvaluationPointSetting" ("id")
SELECT 'default'
WHERE NOT EXISTS (SELECT 1 FROM "public"."EvaluationPointSetting" WHERE "id" = 'default');

-- 行ごとの鍵（RLS）を有効にする。ポリシーは作らない -------------------------------
--   アプリ（Prisma）は、表の持ち主（postgres）でつなぐので RLS の対象外＝動きは変わらない
--   （FORCE ROW LEVEL SECURITY は付けない）。
--   Supabase の公開キー（anon / authenticated）には、もともと表の権限が無い。その上の二重の鍵。
--   public の全テーブルで有効にする SQL（docs/manual-migrations/2026-10-03_enable_rls_all_public.sql）を
--   流す前でも後でも、この5つが同じ状態になるようにしておく。
ALTER TABLE "public"."EvaluationPointItem"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EvaluationPointRate"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EvaluationPointRecord"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EvaluationPointLog"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EvaluationPointSetting" ENABLE ROW LEVEL SECURITY;
