-- CreateTable
-- 領収書・レシート。アップロード→Claude APIで読み取り→費目を仕分けて確定する。
-- 仕入請求書(PurchaseInvoice)の簡易版: 支払済みの記録のため PaymentSchedule・Payee・原価エンジン集計は行わない。
-- 案件(projectMasterId)は参照・検索用の任意リンク（原価には計上しない）。
CREATE TABLE "public"."Receipt" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
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
    "projectMasterId" TEXT,
    "paymentMethod" TEXT,
    "paidBy" TEXT,
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Receipt_status_idx" ON "public"."Receipt"("status");

-- CreateIndex
CREATE INDEX "Receipt_issueDate_idx" ON "public"."Receipt"("issueDate");

-- CreateIndex
CREATE INDEX "Receipt_expenseCategoryId_idx" ON "public"."Receipt"("expenseCategoryId");

-- CreateIndex
CREATE INDEX "Receipt_projectMasterId_idx" ON "public"."Receipt"("projectMasterId");

-- CreateIndex
CREATE INDEX "Receipt_createdAt_idx" ON "public"."Receipt"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."Receipt" ADD CONSTRAINT "Receipt_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Receipt" ADD CONSTRAINT "Receipt_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
