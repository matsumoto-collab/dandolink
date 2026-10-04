-- 手当（現場の手当。最初は「大規模手当」）
--
-- 目的: 工事内容が「大規模」の現場に入った日の手当（その日の班の職長・職長以外で金額が違う）を
--       1人・1日ずつ記録し、月ごとに人別の日数と金額を出せるようにする。
--
-- 追加のみ。既存テーブルの削除・型変更・データ更新は行わない
-- （出勤簿 AttendanceRecord・評価ポイント EvaluationPoint* にも触らない）。
--   1. AllowanceItem        … 手当の種類（最初の1行「大規模手当」も、ここで作る。使わない状態で始める）
--   2. AllowanceRate        … 金額の履歴（適用開始日つき・追記のみ。最初の金額も、ここで作る）
--   3. AllowanceRecord      … 手当の記録（1人・1日・1つの手当で1行。金額は、記録の日付に有効な金額の写し）
--   4. AllowanceMonthClose  … 締めた月（行がある＝締めてある）
--   5. AllowanceLog         … 操作の履歴（追記のみ）
--   6. AllowanceSetting     … 公開の設定（1行だけ）と、その初期行
-- 6つとも、行ごとの鍵（RLS）を有効にする（いちばん下。ポリシーは作らない）。
-- 何度流しても同じ結果になる。

-- 1. 手当の種類 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."AllowanceItem" (
    "id"                  TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name"                TEXT NOT NULL,
    "description"         TEXT,
    "constructionContent" TEXT NOT NULL,
    "sortOrder"           INTEGER NOT NULL DEFAULT 0,
    "isActive"            BOOLEAN NOT NULL DEFAULT false,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AllowanceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AllowanceItem_sortOrder_idx"
    ON "public"."AllowanceItem" ("sortOrder");

-- 2. 金額の履歴 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."AllowanceRate" (
    "id"            TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "itemId"        TEXT NOT NULL,
    "foremanAmount" INTEGER NOT NULL,
    "memberAmount"  INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdBy"     TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AllowanceRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AllowanceRate_itemId_effectiveFrom_idx"
    ON "public"."AllowanceRate" ("itemId", "effectiveFrom");

-- 3. 記録 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."AllowanceRecord" (
    "id"              TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "userId"          TEXT NOT NULL,
    "date"            DATE NOT NULL,
    "itemId"          TEXT NOT NULL,
    "itemName"        TEXT NOT NULL,
    "payRole"         TEXT NOT NULL,
    "amount"          INTEGER NOT NULL,
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
    CONSTRAINT "AllowanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AllowanceRecord_userId_date_itemId_key"
    ON "public"."AllowanceRecord" ("userId", "date", "itemId");
CREATE INDEX IF NOT EXISTS "AllowanceRecord_date_idx"
    ON "public"."AllowanceRecord" ("date");
CREATE INDEX IF NOT EXISTS "AllowanceRecord_itemId_idx"
    ON "public"."AllowanceRecord" ("itemId");
CREATE INDEX IF NOT EXISTS "AllowanceRecord_status_idx"
    ON "public"."AllowanceRecord" ("status");

-- 4. 締めた月 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."AllowanceMonthClose" (
    "month"        TEXT NOT NULL,
    "closedBy"     TEXT NOT NULL,
    "closedByName" TEXT NOT NULL DEFAULT '',
    "closedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AllowanceMonthClose_pkey" PRIMARY KEY ("month")
);

-- 5. 操作の履歴 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."AllowanceLog" (
    "id"           TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "action"       TEXT NOT NULL,
    "actorId"      TEXT NOT NULL,
    "actorName"    TEXT NOT NULL DEFAULT '',
    "targetUserId" TEXT,
    "itemId"       TEXT,
    "recordId"     TEXT,
    "recordDate"   DATE,
    "month"        TEXT,
    "detail"       JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AllowanceLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AllowanceLog_createdAt_idx"
    ON "public"."AllowanceLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "AllowanceLog_targetUserId_recordDate_idx"
    ON "public"."AllowanceLog" ("targetUserId", "recordDate");

-- 6. 公開の設定 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."AllowanceSetting" (
    "id"            TEXT NOT NULL DEFAULT 'default',
    "showToMembers" BOOLEAN NOT NULL DEFAULT false,
    "memberNotice"  TEXT,
    "updatedBy"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AllowanceSetting_pkey" PRIMARY KEY ("id")
);

-- 外部キー（既に張られていれば何もしない）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AllowanceRate_itemId_fkey') THEN
        ALTER TABLE "public"."AllowanceRate"
            ADD CONSTRAINT "AllowanceRate_itemId_fkey"
            FOREIGN KEY ("itemId") REFERENCES "public"."AllowanceItem"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AllowanceRecord_itemId_fkey') THEN
        ALTER TABLE "public"."AllowanceRecord"
            ADD CONSTRAINT "AllowanceRecord_itemId_fkey"
            FOREIGN KEY ("itemId") REFERENCES "public"."AllowanceItem"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 最初の手当「大規模手当」（使わない状態で始める。設定の「手当」タブで「使う」にするまで、どの画面にも出ない）。
-- 既にあれば何もしない
INSERT INTO "public"."AllowanceItem" ("id", "name", "description", "constructionContent", "sortOrder", "isActive")
SELECT 'allowance-large-scale', '大規模手当', '工事内容が「大規模」の現場に入った日に付けます。職長の金額になるのは、その日の手配で、その現場の職長になっている人です。', '大規模', 0, false
WHERE NOT EXISTS (SELECT 1 FROM "public"."AllowanceItem" WHERE "id" = 'allowance-large-scale');

-- 最初の金額（kei 2026-10-03: 職長 1日 1,500円・職長以外 1日 200円。2026年9月分から）。
-- この手当に金額の行が1つでもあれば何もしない
INSERT INTO "public"."AllowanceRate" ("id", "itemId", "foremanAmount", "memberAmount", "effectiveFrom", "createdByName")
SELECT 'allowance-large-scale-rate-1', 'allowance-large-scale', 1500, 200, DATE '2026-09-01', '（最初の設定）'
WHERE NOT EXISTS (SELECT 1 FROM "public"."AllowanceRate" WHERE "itemId" = 'allowance-large-scale');

-- 公開の設定の初期行（本人には見せない状態で始める。既にあれば何もしない）
INSERT INTO "public"."AllowanceSetting" ("id")
SELECT 'default'
WHERE NOT EXISTS (SELECT 1 FROM "public"."AllowanceSetting" WHERE "id" = 'default');

-- 行ごとの鍵（RLS）を有効にする。ポリシーは作らない -------------------------------
--   アプリ（Prisma）は、表の持ち主（postgres）でつなぐので RLS の対象外＝動きは変わらない
--   （FORCE ROW LEVEL SECURITY は付けない）。
--   Supabase の公開キー（anon / authenticated）には、もともと表の権限が無い
--   （評価ポイントの5つのテーブルで、権限が付いていないことを 2026-10-04 に本番で確かめた）。その上の二重の鍵。
--   評価ポイントの5つのテーブル（20261003153000_add_evaluation_points）と同じ扱い。
ALTER TABLE "public"."AllowanceItem"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AllowanceRate"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AllowanceRecord"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AllowanceMonthClose" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AllowanceLog"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AllowanceSetting"    ENABLE ROW LEVEL SECURITY;
