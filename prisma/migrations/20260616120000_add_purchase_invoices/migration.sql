-- CreateTable
-- 仕入請求書の費目マスタ。costBucket で原価エンジンの集計先（material/other/loading）を決める。
CREATE TABLE "public"."ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costBucket" TEXT NOT NULL DEFAULT 'other',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- 仕入先・リース会社・資材店などからの支払側請求書（買掛）。1枚=1レコード。
CREATE TABLE "public"."PurchaseInvoice" (
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
    "payeeName" TEXT,
    "payeeId" TEXT,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(12,2),
    "taxAmount" DECIMAL(12,2),
    "projectMasterId" TEXT,
    "expenseCategoryId" TEXT,
    "notes" TEXT,
    "paymentScheduleId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- 仕入請求書の明細行（AI抽出の品目）。原価計算は totalAmount を使うため表示・確認用。
CREATE TABLE "public"."PurchaseInvoiceItem" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "unitPrice" DECIMAL(12,2),
    "amount" DECIMAL(12,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseCategory_sortOrder_idx" ON "public"."ExpenseCategory"("sortOrder");

-- CreateIndex
CREATE INDEX "ExpenseCategory_isActive_idx" ON "public"."ExpenseCategory"("isActive");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_status_idx" ON "public"."PurchaseInvoice"("status");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_projectMasterId_idx" ON "public"."PurchaseInvoice"("projectMasterId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_payeeId_idx" ON "public"."PurchaseInvoice"("payeeId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_expenseCategoryId_idx" ON "public"."PurchaseInvoice"("expenseCategoryId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_createdAt_idx" ON "public"."PurchaseInvoice"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceItem_purchaseInvoiceId_idx" ON "public"."PurchaseInvoiceItem"("purchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "public"."Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "public"."PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
