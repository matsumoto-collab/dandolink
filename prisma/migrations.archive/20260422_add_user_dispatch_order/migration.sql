-- AlterTable
ALTER TABLE "public"."User"
  ADD COLUMN "dispatchSortOrder" INTEGER,
  ADD COLUMN "hideByDefaultInDispatch" BOOLEAN NOT NULL DEFAULT false;
