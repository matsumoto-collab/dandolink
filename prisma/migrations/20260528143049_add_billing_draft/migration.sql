-- ============================================================================
-- 請求予定（BillingDraft）テーブル新設
-- invoice_plan.md rev.9 §14 確定仕様。BillingDraft 1 テーブルのみ新設、
-- 既存テーブルへの列追加・enum 追加は一切なし。
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."BillingDraftStatus" AS ENUM ('pending', 'confirmed', 'cancelled');

-- CreateTable
CREATE TABLE "public"."BillingDraft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
    "status" "public"."BillingDraftStatus" NOT NULL DEFAULT 'pending',
    "invoiceId" TEXT,
    "createdById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BillingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingDraft_projectId_status_idx" ON "public"."BillingDraft"("projectId", "status");

-- CreateIndex
CREATE INDEX "BillingDraft_customerId_status_idx" ON "public"."BillingDraft"("customerId", "status");

-- CreateIndex
CREATE INDEX "BillingDraft_invoiceId_idx" ON "public"."BillingDraft"("invoiceId");

-- CreateIndex
CREATE INDEX "BillingDraft_deletedAt_idx" ON "public"."BillingDraft"("deletedAt");

-- AddForeignKey
ALTER TABLE "public"."BillingDraft" ADD CONSTRAINT "BillingDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."ProjectMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingDraft" ADD CONSTRAINT "BillingDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingDraft" ADD CONSTRAINT "BillingDraft_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingDraft" ADD CONSTRAINT "BillingDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 改ざん防止トリガ
-- BillingDraft.status = 'confirmed' のレコードは、amount / projectId / customerId
-- の UPDATE を物理的に拒否する。アプリ層のガードと併せた二重防御。
-- ============================================================================

-- CreateFunction
CREATE OR REPLACE FUNCTION "public".protect_confirmed_billing_draft() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'confirmed' THEN
    IF NEW."amount" IS DISTINCT FROM OLD."amount"
       OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
       OR NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
      RAISE EXCEPTION 'Cannot modify amount/projectId/customerId of confirmed BillingDraft (id: %)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
CREATE TRIGGER trg_protect_confirmed_billing_draft
  BEFORE UPDATE ON "public"."BillingDraft"
  FOR EACH ROW EXECUTE FUNCTION "public".protect_confirmed_billing_draft();
