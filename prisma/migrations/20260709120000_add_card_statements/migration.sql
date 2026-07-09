-- CreateTable
-- クレジットカード明細の仕分け・レシート照合機能。
-- CardReceipt: カード利用レシートの受け箱（アップロード→AI読み取り→明細行と照合）。
-- CardStatement: 「ご利用代金明細書」1PDF=1件。AIで明細行を全行抽出する。
-- CardStatementLine: 明細書の1行。費目仕分け（会計用途のみ・原価非連携）と照合状態を持つ。
-- 領収書(Receipt)・現金出納帳(CashbookEntry)・原価計算・利益計算とは完全に独立（連携しない）。
-- アクセスは User.canAccessCashbook 保持者のみ（現金出納帳と同一の個別許可制）。
CREATE TABLE "public"."CardReceipt" (
    "id" TEXT NOT NULL,
    "cardLabel" TEXT,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sourceType" TEXT,
    "signedUrl" TEXT,
    "signedUrlExpiresAt" TIMESTAMP(3),
    "thumbnailSignedUrl" TEXT,
    "thumbnailSignedUrlExpiresAt" TIMESTAMP(3),
    "extractedData" JSONB,
    "storeName" TEXT,
    "issueDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(12,2),
    "taxAmount" DECIMAL(12,2),
    "expenseCategoryId" TEXT,
    "notes" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CardStatement" (
    "id" TEXT NOT NULL,
    "cardLabel" TEXT NOT NULL,
    "memberName" TEXT,
    "cardLast4" TEXT,
    "closingDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(12,2),
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sourceType" TEXT,
    "signedUrl" TEXT,
    "signedUrlExpiresAt" TIMESTAMP(3),
    "thumbnailSignedUrl" TEXT,
    "thumbnailSignedUrlExpiresAt" TIMESTAMP(3),
    "extractedData" JSONB,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CardStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "useDate" TIMESTAMP(3) NOT NULL,
    "storeName" TEXT NOT NULL,
    "storeCategory" TEXT,
    "foreignAmount" DECIMAL(14,2),
    "currency" TEXT,
    "exchangeRate" DECIMAL(12,4),
    "amount" DECIMAL(12,2) NOT NULL,
    "itemDetails" TEXT,
    "expenseCategoryId" TEXT,
    "notes" TEXT,
    "cardReceiptId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardReceipt_issueDate_idx" ON "public"."CardReceipt"("issueDate");

-- CreateIndex
CREATE INDEX "CardReceipt_totalAmount_idx" ON "public"."CardReceipt"("totalAmount");

-- CreateIndex
CREATE INDEX "CardReceipt_createdAt_idx" ON "public"."CardReceipt"("createdAt");

-- CreateIndex
CREATE INDEX "CardStatement_cardLabel_idx" ON "public"."CardStatement"("cardLabel");

-- CreateIndex
CREATE INDEX "CardStatement_closingDate_idx" ON "public"."CardStatement"("closingDate");

-- CreateIndex
CREATE INDEX "CardStatement_createdAt_idx" ON "public"."CardStatement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardStatementLine_cardReceiptId_key" ON "public"."CardStatementLine"("cardReceiptId");

-- CreateIndex
CREATE INDEX "CardStatementLine_statementId_idx" ON "public"."CardStatementLine"("statementId");

-- CreateIndex
CREATE INDEX "CardStatementLine_status_idx" ON "public"."CardStatementLine"("status");

-- CreateIndex
CREATE INDEX "CardStatementLine_expenseCategoryId_idx" ON "public"."CardStatementLine"("expenseCategoryId");

-- AddForeignKey
ALTER TABLE "public"."CardReceipt" ADD CONSTRAINT "CardReceipt_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CardStatementLine" ADD CONSTRAINT "CardStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "public"."CardStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CardStatementLine" ADD CONSTRAINT "CardStatementLine_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CardStatementLine" ADD CONSTRAINT "CardStatementLine_cardReceiptId_fkey" FOREIGN KEY ("cardReceiptId") REFERENCES "public"."CardReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
