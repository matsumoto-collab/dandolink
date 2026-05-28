-- 協力業者出来高: 自動行の論理削除（再生成抑止）と復元機能のための列追加
-- deletedAt != null の行は GET の rows から除外される一方、usedAutoKeys に登録されるため
-- 同じ (assignmentId, rowType) の auto 行が再生成されない。
ALTER TABLE "public"."PartnerWorkVolume"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedBy" TEXT;

CREATE INDEX "PartnerWorkVolume_partnerCompanyId_date_deletedAt_idx"
  ON "public"."PartnerWorkVolume"("partnerCompanyId", "date", "deletedAt");
