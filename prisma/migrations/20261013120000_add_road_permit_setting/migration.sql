-- 道路申請: 担当者の候補（docs/指示書_道路申請_担当者の選択と住所.md §3.1）
--
-- 目的: 申請書の「担当者」「現場責任者」を候補（例: 今井 公一郎／三生 浩人）から選べるようにする。
--       候補は RoadPermitSetting（1 行だけ。AllowanceSetting と同じ作り）の contacts（JSON）に持つ。
--       候補の名前・電話番号はここには書かない（画面「担当者の候補」で登録する）。
--
-- 追加のみ。既存テーブルの削除・型変更・データ更新は行わない。
-- 行ごとの鍵（RLS）を有効にする（いちばん下。ポリシーは作らない）。
-- 何度流しても同じ結果になる。

CREATE TABLE IF NOT EXISTS "public"."RoadPermitSetting" (
    "id"        TEXT NOT NULL DEFAULT 'default',
    "contacts"  JSONB NOT NULL DEFAULT '[]'::jsonb,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoadPermitSetting_pkey" PRIMARY KEY ("id")
);

-- 初期行（候補は空。無ければ作る）
INSERT INTO "public"."RoadPermitSetting" ("id", "contacts")
SELECT 'default', '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "public"."RoadPermitSetting" WHERE "id" = 'default');

-- 行ごとの鍵（RLS）を有効にする。ポリシーは作らない -------------------------------
--   アプリ（Prisma）は、表の持ち主（postgres）でつなぐので RLS の対象外＝動きは変わらない
--   （FORCE ROW LEVEL SECURITY は付けない）。
--   Supabase の公開キー（anon / authenticated）には、もともと表の権限が無い。その上の二重の鍵。
--   RoadPermit（20261012120000_add_road_permit）と同じ扱い。
ALTER TABLE "public"."RoadPermitSetting" ENABLE ROW LEVEL SECURITY;
