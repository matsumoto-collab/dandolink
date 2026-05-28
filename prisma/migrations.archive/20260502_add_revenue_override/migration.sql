-- Add revenue override on ProjectMaster (admin/manager edit)
ALTER TABLE "ProjectMaster" ADD COLUMN IF NOT EXISTS "revenueOverride" INTEGER;
