-- AlterTable
-- 請求判断ボード用：案件ごとの請求判断（pending=判断待ち / hold=保留 / excluded=対象外）を保持する。
-- 既定 'pending'・追加カラムのみ＝後方互換。「請求する」は BillingDraft 作成で表現するため本カラムには持たない。
ALTER TABLE "public"."ProjectMaster" ADD COLUMN "billingDecision" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "public"."ProjectMaster" ADD COLUMN "billingDecisionBy" TEXT;
ALTER TABLE "public"."ProjectMaster" ADD COLUMN "billingDecisionAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ProjectMaster_billingDecision_idx" ON "public"."ProjectMaster"("billingDecision");
