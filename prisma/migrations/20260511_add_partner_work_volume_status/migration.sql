-- 協力業者出来高: 行ごとの完了ステータス
-- 各行を担当者が「完了」ボタンで確定する。全行 completed になった時点で partner に公開
ALTER TABLE "public"."PartnerWorkVolume"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "completedBy" TEXT;

CREATE INDEX "PartnerWorkVolume_partnerCompanyId_status_idx"
  ON "public"."PartnerWorkVolume"("partnerCompanyId", "status");
