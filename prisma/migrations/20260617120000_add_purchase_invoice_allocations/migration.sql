-- CreateTable
-- 仕入請求書の案件配分行。1枚の請求書を複数案件へ按分計上するための行（案件×費目×金額）。
-- 原価エンジンは確定済み請求書のこの配分行を案件ごとに集計する。支払い自体は請求書1枚=1本のまま。
CREATE TABLE "public"."PurchaseInvoiceAllocation" (
    "id" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "projectMasterId" TEXT,
    "expenseCategoryId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseInvoiceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseInvoiceAllocation_purchaseInvoiceId_idx" ON "public"."PurchaseInvoiceAllocation"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceAllocation_projectMasterId_idx" ON "public"."PurchaseInvoiceAllocation"("projectMasterId");

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoiceAllocation" ADD CONSTRAINT "PurchaseInvoiceAllocation_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "public"."PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoiceAllocation" ADD CONSTRAINT "PurchaseInvoiceAllocation_projectMasterId_fkey" FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseInvoiceAllocation" ADD CONSTRAINT "PurchaseInvoiceAllocation_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "public"."ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: 既存の仕入請求書（案件紐付け済み）を1請求書=1配分行として移行する。
-- これにより、確定済みデータの原価計上を配分行ベースへ切り替えても従来どおり（金額＝totalAmount）に保たれる。
INSERT INTO "public"."PurchaseInvoiceAllocation"
    ("id", "purchaseInvoiceId", "projectMasterId", "expenseCategoryId", "amount", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", "projectMasterId", "expenseCategoryId", COALESCE("totalAmount", 0), 0, now(), now()
FROM "public"."PurchaseInvoice"
WHERE "projectMasterId" IS NOT NULL;
