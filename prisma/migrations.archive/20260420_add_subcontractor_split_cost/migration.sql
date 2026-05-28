-- 協力業者費の組立/解体分割フィールドを追加
ALTER TABLE "public"."ProjectMaster"
  ADD COLUMN "subcontractorAssemblyCost" DECIMAL(12,2),
  ADD COLUMN "subcontractorDemolitionCost" DECIMAL(12,2);

-- 協力業者費率のシステム設定を追加
ALTER TABLE "public"."SystemSettings"
  ADD COLUMN "subcontractorRevenueRate" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "subcontractorAssemblyRate" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "subcontractorDemolitionRate" INTEGER NOT NULL DEFAULT 40;
