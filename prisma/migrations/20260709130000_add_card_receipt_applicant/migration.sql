-- AlterTable
-- カードレシート受け箱に担当名（氏名・自由入力）を追加。
-- 既定はアップロードした人の名前（API側で設定）。CashbookEntry.applicantName と同じ扱い。
ALTER TABLE "public"."CardReceipt" ADD COLUMN "applicantName" TEXT;
