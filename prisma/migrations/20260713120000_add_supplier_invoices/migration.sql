-- 支払予定への請求書AI取込（受け箱）。
-- SupplierInvoice: 他社から届いた請求書のアップロード→AI読み取り→振込先マスター照合→支払予定へ追加。
-- 旧・仕入請求書(PurchaseInvoice。取込機能撤去済み)とは独立。原価計算・案件配分には一切連携しない。
-- Payee: 支払サイト（締め日・支払月・支払日）を追加。請求書に期日が無い場合の支払日自動提案に使う。
-- アクセスは支払予定と同じ（閲覧=admin/accountant、編集=admin）。

-- AlterTable
ALTER TABLE "public"."Payee" ADD COLUMN "closingDay" INTEGER;
ALTER TABLE "public"."Payee" ADD COLUMN "paymentMonthOffset" INTEGER;
ALTER TABLE "public"."Payee" ADD COLUMN "paymentDay" INTEGER;

-- CreateTable
CREATE TABLE "public"."SupplierInvoice" (
    "id" TEXT NOT NULL,
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
    "payeeKana" TEXT,
    "bankName" TEXT,
    "branchName" TEXT,
    "accountType" TEXT,
    "accountNumber" TEXT,
    "accountHolder" TEXT,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(12,2),
    "taxAmount" DECIMAL(12,2),
    "registrationNumber" TEXT,
    "notes" TEXT,
    "payeeId" TEXT,
    "paymentScheduleId" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierInvoice_dueDate_idx" ON "public"."SupplierInvoice"("dueDate");

-- CreateIndex
CREATE INDEX "SupplierInvoice_payeeId_idx" ON "public"."SupplierInvoice"("payeeId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_paymentScheduleId_idx" ON "public"."SupplierInvoice"("paymentScheduleId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_createdAt_idx" ON "public"."SupplierInvoice"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "public"."Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_paymentScheduleId_fkey" FOREIGN KEY ("paymentScheduleId") REFERENCES "public"."PaymentSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
