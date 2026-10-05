-- 評価ポイント: ありがとう
--
-- 目的: 社員どうしが「相手を選んで」送る「ありがとう」を1件ずつ記録し、
--       もらった数を、評価ポイントの集計に足せるようにする（kei 決定 2026-10-05）。
--
-- 追加のみ。既存テーブルの削除・型変更・データ更新は行わない
-- （評価ポイントの5つのテーブル EvaluationPoint*・出勤簿 AttendanceRecord にも触らない）。
--   1. EvaluationPointThanks         … 「ありがとう」の記録（だれが・だれに・いつ。同じ相手には1日1回まで）
--   2. EvaluationPointThanksSetting  … 設定（1行だけ。使う／使わない・1回あたりの点数）と、その初期行
-- 2つとも、行ごとの鍵（RLS）を有効にする（いちばん下。ポリシーは作らない）。
-- 何度流しても同じ結果になる。

-- 1. 「ありがとう」の記録 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."EvaluationPointThanks" (
    "id"         TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "fromUserId" TEXT NOT NULL,
    "toUserId"   TEXT NOT NULL,
    "date"       DATE NOT NULL,
    "message"    TEXT,
    "points"     INTEGER NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationPointThanks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EvaluationPointThanks_fromUserId_toUserId_date_key"
    ON "public"."EvaluationPointThanks" ("fromUserId", "toUserId", "date");
CREATE INDEX IF NOT EXISTS "EvaluationPointThanks_toUserId_date_idx"
    ON "public"."EvaluationPointThanks" ("toUserId", "date");
CREATE INDEX IF NOT EXISTS "EvaluationPointThanks_date_idx"
    ON "public"."EvaluationPointThanks" ("date");

-- 2. 設定 -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."EvaluationPointThanksSetting" (
    "id"              TEXT NOT NULL DEFAULT 'default',
    "isActive"        BOOLEAN NOT NULL DEFAULT false,
    "pointsPerThanks" INTEGER NOT NULL DEFAULT 1,
    "updatedBy"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationPointThanksSetting_pkey" PRIMARY KEY ("id")
);

-- 設定の初期行（「使わない」・1回 1点で始める。設定の「評価ポイント」タブで「使う」にするまで、だれも送れない）。
-- 既にあれば何もしない
INSERT INTO "public"."EvaluationPointThanksSetting" ("id")
SELECT 'default'
WHERE NOT EXISTS (SELECT 1 FROM "public"."EvaluationPointThanksSetting" WHERE "id" = 'default');

-- 行ごとの鍵（RLS）を有効にする。ポリシーは作らない -------------------------------
--   アプリ（Prisma）は、表の持ち主（postgres）でつなぐので RLS の対象外＝動きは変わらない
--   （FORCE ROW LEVEL SECURITY は付けない）。
--   Supabase の公開キー（anon / authenticated）には、もともと表の権限が無い。その上の二重の鍵。
--   評価ポイントの5つのテーブル（20261003153000_add_evaluation_points）と同じ扱い。
ALTER TABLE "public"."EvaluationPointThanks"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EvaluationPointThanksSetting" ENABLE ROW LEVEL SECURITY;
