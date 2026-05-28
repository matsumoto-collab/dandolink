-- 見積書・請求書のバージョン履歴テーブル
CREATE TABLE "public"."EstimateVersion" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "estimateNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "location" TEXT,
    "costTotal" INTEGER,
    "constructionPeriod" TEXT,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "EstimateVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EstimateVersion_estimateId_versionNumber_key"
    ON "public"."EstimateVersion"("estimateId", "versionNumber");

CREATE INDEX "EstimateVersion_estimateId_versionNumber_idx"
    ON "public"."EstimateVersion"("estimateId", "versionNumber" DESC);

CREATE TABLE "public"."InvoiceVersion" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "paidDate" TIMESTAMP(3),
    "notes" TEXT,
    "estimateId" TEXT,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "projectMasterIdsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "InvoiceVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceVersion_invoiceId_versionNumber_key"
    ON "public"."InvoiceVersion"("invoiceId", "versionNumber");

CREATE INDEX "InvoiceVersion_invoiceId_versionNumber_idx"
    ON "public"."InvoiceVersion"("invoiceId", "versionNumber" DESC);
