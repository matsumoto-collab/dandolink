-- 道路申請: 図面に置く記号（docs/指示書_道路申請_Phase2b_記号.md §3.1）
--
-- 目的: カラーコーン・コーンバー・トラック・誘導員などの記号を、kei が用意した JWW データから
--       画面「記号の登録」で取り込んで持つ。図面（RoadPermit.drawing）の SymbolEntity は symbolId でこの行を指す。
--       形（geometry）は実寸 mm・基準点（中心）が原点の JSON。取り込んだあと形は直さない（消すかわりに isActive=false）。
--       記号のデータは DB にだけ置く（リポジトリに入れない。CAD素材.com の利用条件・設計書 §6.4）。
--
-- 追加のみ。既存テーブルの削除・型変更・データ更新は行わない。初期データは入れない。
-- 行ごとの鍵（RLS）を有効にする（いちばん下。ポリシーは作らない）。
-- 何度流しても同じ結果になる。

CREATE TABLE IF NOT EXISTS "public"."RoadPermitSymbol" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "category"    TEXT NOT NULL DEFAULT 'other',
    "countLabel"  TEXT NOT NULL DEFAULT '',
    "countUnit"   TEXT NOT NULL DEFAULT '',
    "countNote"   TEXT NOT NULL DEFAULT '',
    "geometry"    JSONB NOT NULL,
    "lengthMm"    DOUBLE PRECISION NOT NULL,
    "widthMm"     DOUBLE PRECISION NOT NULL,
    "barPitchMm"  INTEGER,
    "sourceFile"  TEXT NOT NULL DEFAULT '',
    "sourceBlock" TEXT NOT NULL DEFAULT '',
    "sourceNote"  TEXT NOT NULL DEFAULT '',
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdBy"   TEXT,
    "updatedBy"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoadPermitSymbol_pkey" PRIMARY KEY ("id")
);

-- パレット・一覧は 分類 → 並び順 で読む
CREATE INDEX IF NOT EXISTS "RoadPermitSymbol_category_sortOrder_idx"
    ON "public"."RoadPermitSymbol" ("category", "sortOrder");

-- 行ごとの鍵（RLS）を有効にする。ポリシーは作らない -------------------------------
--   アプリ（Prisma）は、表の持ち主（postgres）でつなぐので RLS の対象外＝動きは変わらない
--   （FORCE ROW LEVEL SECURITY は付けない）。
--   Supabase の公開キー（anon / authenticated）には、もともと表の権限が無い。その上の二重の鍵。
--   RoadPermit・RoadPermitSetting と同じ扱い。
ALTER TABLE "public"."RoadPermitSymbol" ENABLE ROW LEVEL SECURITY;
