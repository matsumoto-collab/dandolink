-- AlterTable
-- 現金出納帳へのアクセス許可（個別ユーザー指定）。admin ロールでも false なら不可。
ALTER TABLE "public"."User" ADD COLUMN "canAccessCashbook" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
-- 現金出納帳の行。閲覧・編集は User.canAccessCashbook を持つユーザーのみ（個別許可制）。
-- 入金('in')は手打ちのみ、出金('out')は手打ち＋領収書画像/PDFのAI読み取りで作成。
-- 差引残高は DB に持たず、表示時に (date asc, seq asc) 順の累計で計算する。
-- 既存の領収書(Receipt)・原価計算・利益計算とは完全に独立（連携しない）。
CREATE TABLE "public"."CashbookEntry" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "entryType" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expenseCategoryId" TEXT,
    "fileName" TEXT,
    "storagePath" TEXT,
    "thumbnailPath" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "sourceType" TEXT,
    "signedUrl" TEXT,
    "signedUrlExpiresAt" TIMESTAMP(3),
    "thumbnailSignedUrl" TEXT,
    "thumbnailSignedUrlExpiresAt" TIMESTAMP(3),
    "extractedData" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashbookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashbookEntry_seq_key" ON "public"."CashbookEntry"("seq");

-- CreateIndex
CREATE INDEX "CashbookEntry_date_idx" ON "public"."CashbookEntry"("date");

-- CreateIndex
CREATE INDEX "CashbookEntry_expenseCategoryId_idx" ON "public"."CashbookEntry"("expenseCategoryId");

-- CreateIndex
CREATE INDEX "CashbookEntry_createdAt_idx" ON "public"."CashbookEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."CashbookEntry" ADD CONSTRAINT "CashbookEntry_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
