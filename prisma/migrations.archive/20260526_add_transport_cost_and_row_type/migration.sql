-- 協力業者費に「運搬費」を追加
ALTER TABLE "public"."ProjectMasterSubcontractorCost"
    ADD COLUMN "transportCost" DECIMAL(12, 2);

-- 協力業者出来高に「行種別」(work / transport) を追加
-- 1つの配置に対して「作業費の行」と「運搬費の行」を別々に保持できるようにする
ALTER TABLE "public"."PartnerWorkVolume"
    ADD COLUMN "rowType" TEXT NOT NULL DEFAULT 'work';

-- 既存の (sourceAssignmentId @unique) 制約を、(sourceAssignmentId, rowType) の複合 unique に置き換える
ALTER TABLE "public"."PartnerWorkVolume"
    DROP CONSTRAINT IF EXISTS "PartnerWorkVolume_sourceAssignmentId_key";

DROP INDEX IF EXISTS "public"."PartnerWorkVolume_sourceAssignmentId_key";

CREATE UNIQUE INDEX "PartnerWorkVolume_sourceAssignmentId_rowType_key"
    ON "public"."PartnerWorkVolume" ("sourceAssignmentId", "rowType");
