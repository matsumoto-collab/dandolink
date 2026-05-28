-- Add per-assignment cost override columns (admin/manager edit)
ALTER TABLE "ProjectAssignment" ADD COLUMN IF NOT EXISTS "laborCostOverride" INTEGER;
ALTER TABLE "ProjectAssignment" ADD COLUMN IF NOT EXISTS "vehicleCostOverride" INTEGER;
ALTER TABLE "ProjectAssignment" ADD COLUMN IF NOT EXISTS "subcontractorCostOverride" INTEGER;

-- Add loadingCost on ProjectMaster (was previously hardcoded 0)
ALTER TABLE "ProjectMaster" ADD COLUMN IF NOT EXISTS "loadingCost" DECIMAL(12, 2);
