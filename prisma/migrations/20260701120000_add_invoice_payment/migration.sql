-- CreateTable
-- 請求書への入金記録。1請求書に複数回（分割入金）ぶら下がる。
-- 利益計算には影響させず「未収金の見える化」レイヤーとして使う（パターンA）。
-- 残額 = Invoice.total − Σ amount − Σ fee（fee=振込手数料の当社負担相殺分）。
CREATE TABLE "public"."InvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paidDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "method" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "public"."InvoicePayment"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePayment_paidDate_idx" ON "public"."InvoicePayment"("paidDate");

-- AddForeignKey
ALTER TABLE "public"."InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
