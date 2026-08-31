-- 足場仕様の「項目ごとの既定値」と「テンプレート（プリセット）」を追加する。
-- 既存データには一切触らない（列追加とテーブル追加のみ）。

-- 1) 項目の既定値。新規案件を開いたときに最初から入っている値。
--    ProjectMaster.scaffoldingSpec と同じ形（toggle=true/false、segment/text=文字列）。
--    NULL = 既定値なし＝従来どおり未入力で開く。
ALTER TABLE "public"."ScaffoldingSpecItem" ADD COLUMN IF NOT EXISTS "defaultValue" JSONB;

-- 2) 足場仕様のテンプレート。
--    ownerId = 作成者専用 / NULL = 全社共有。
CREATE TABLE IF NOT EXISTS "public"."ScaffoldingSpecPreset" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "ownerId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScaffoldingSpecPreset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScaffoldingSpecPreset_ownerId_idx" ON "public"."ScaffoldingSpecPreset"("ownerId");
CREATE INDEX IF NOT EXISTS "ScaffoldingSpecPreset_sortOrder_idx" ON "public"."ScaffoldingSpecPreset"("sortOrder");
CREATE INDEX IF NOT EXISTS "ScaffoldingSpecPreset_isActive_idx" ON "public"."ScaffoldingSpecPreset"("isActive");
