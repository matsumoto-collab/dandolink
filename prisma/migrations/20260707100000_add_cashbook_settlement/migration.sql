-- AlterTable
-- 現金出納帳: 清算日（月別表示と残高計算は settledAt ?? date 基準）・申請者・手動並び順を追加
ALTER TABLE "public"."CashbookEntry" ADD COLUMN "settledAt" TIMESTAMP(3);
ALTER TABLE "public"."CashbookEntry" ADD COLUMN "applicantName" TEXT;
ALTER TABLE "public"."CashbookEntry" ADD COLUMN "sortOrder" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "CashbookEntry_settledAt_idx" ON "public"."CashbookEntry"("settledAt");
