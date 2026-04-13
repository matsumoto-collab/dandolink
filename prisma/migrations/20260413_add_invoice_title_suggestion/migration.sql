-- CreateTable
CREATE TABLE "public"."InvoiceTitleSuggestion" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceTitleSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceTitleSuggestion_name_idx" ON "public"."InvoiceTitleSuggestion"("name");

-- CreateIndex
CREATE INDEX "InvoiceTitleSuggestion_sortOrder_idx" ON "public"."InvoiceTitleSuggestion"("sortOrder");
