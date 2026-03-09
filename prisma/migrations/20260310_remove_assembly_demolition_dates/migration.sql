-- AlterTable: Remove assemblyDate and demolitionDate columns from ProjectMaster
ALTER TABLE "public"."ProjectMaster" DROP COLUMN IF EXISTS "assemblyDate";
ALTER TABLE "public"."ProjectMaster" DROP COLUMN IF EXISTS "demolitionDate";
