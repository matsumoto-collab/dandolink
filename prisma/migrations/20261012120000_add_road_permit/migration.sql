-- 道路申請（道路使用許可・道路占用許可の申請書）
--
-- 目的: 申請のたびに Word/Excel の様式へ手で書き直していた 自社情報・現場・期間・占用物件 を
--       DandoLink に入力して持ち、警察（道路使用許可申請書）と松山市（道路占用 協議書・回答書）の
--       PDF を作れるようにする（docs/道路申請_設計書.md §8.1・docs/指示書_道路申請_Phase1.md §4）。
--
-- 追加のみ。既存テーブルの削除・型変更・データ更新は行わない。
--   1. RoadPermit … 1 現場の申請一式（入力値 values・様式ごとの提出/許可の記録 documents）。
--      drawing（図面・Phase 2）と sketchFileId（手書きメモの写真・Phase 3）も今のうちに作っておく
--      （マイグレーションを 1 回で済ませる）。
-- 行ごとの鍵（RLS）を有効にする（いちばん下。ポリシーは作らない）。
-- 何度流しても同じ結果になる。

CREATE TABLE IF NOT EXISTS "public"."RoadPermit" (
    "id"              TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "projectMasterId" TEXT,
    "title"           TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'draft',
    "values"          JSONB NOT NULL,
    "documents"       JSONB NOT NULL,
    "drawing"         JSONB,
    "sketchFileId"    TEXT,
    "createdBy"       TEXT,
    "updatedBy"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"       TIMESTAMP(3),
    CONSTRAINT "RoadPermit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RoadPermit_projectMasterId_idx"
    ON "public"."RoadPermit" ("projectMasterId");
CREATE INDEX IF NOT EXISTS "RoadPermit_status_idx"
    ON "public"."RoadPermit" ("status");
CREATE INDEX IF NOT EXISTS "RoadPermit_createdAt_idx"
    ON "public"."RoadPermit" ("createdAt");

-- 案件（ProjectMaster）が消されても申請は残す（projectMasterId を NULL にする）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'RoadPermit_projectMasterId_fkey'
          AND conrelid = '"public"."RoadPermit"'::regclass
    ) THEN
        ALTER TABLE "public"."RoadPermit"
            ADD CONSTRAINT "RoadPermit_projectMasterId_fkey"
            FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 行ごとの鍵（RLS）を有効にする。ポリシーは作らない -------------------------------
--   アプリ（Prisma）は、表の持ち主（postgres）でつなぐので RLS の対象外＝動きは変わらない
--   （FORCE ROW LEVEL SECURITY は付けない）。
--   Supabase の公開キー（anon / authenticated）には、もともと表の権限が無い。その上の二重の鍵。
ALTER TABLE "public"."RoadPermit" ENABLE ROW LEVEL SECURITY;
