-- 協力業者費を工事種別ごとに保存する新テーブル
CREATE TABLE "public"."ProjectMasterSubcontractorCost" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "constructionTypeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMasterSubcontractorCost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMasterSubcontractorCost_projectMasterId_constructionTypeId_key"
    ON "public"."ProjectMasterSubcontractorCost"("projectMasterId", "constructionTypeId");
CREATE INDEX "ProjectMasterSubcontractorCost_projectMasterId_idx"
    ON "public"."ProjectMasterSubcontractorCost"("projectMasterId");
CREATE INDEX "ProjectMasterSubcontractorCost_constructionTypeId_idx"
    ON "public"."ProjectMasterSubcontractorCost"("constructionTypeId");

ALTER TABLE "public"."ProjectMasterSubcontractorCost"
    ADD CONSTRAINT "ProjectMasterSubcontractorCost_projectMasterId_fkey"
    FOREIGN KEY ("projectMasterId") REFERENCES "public"."ProjectMaster"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProjectMasterSubcontractorCost"
    ADD CONSTRAINT "ProjectMasterSubcontractorCost_constructionTypeId_fkey"
    FOREIGN KEY ("constructionTypeId") REFERENCES "public"."ConstructionType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 既存の組立/解体費用を新テーブルへ移行
-- 組立
INSERT INTO "public"."ProjectMasterSubcontractorCost" ("id", "projectMasterId", "constructionTypeId", "amount", "sortOrder", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    pm."id",
    ct."id",
    pm."subcontractorAssemblyCost",
    0,
    NOW(),
    NOW()
FROM "public"."ProjectMaster" pm
CROSS JOIN LATERAL (
    SELECT "id" FROM "public"."ConstructionType" WHERE "name" = '組立' AND "isActive" = true LIMIT 1
) ct
WHERE pm."subcontractorAssemblyCost" IS NOT NULL
  AND pm."subcontractorAssemblyCost" > 0
ON CONFLICT DO NOTHING;

-- 解体
INSERT INTO "public"."ProjectMasterSubcontractorCost" ("id", "projectMasterId", "constructionTypeId", "amount", "sortOrder", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    pm."id",
    ct."id",
    pm."subcontractorDemolitionCost",
    1,
    NOW(),
    NOW()
FROM "public"."ProjectMaster" pm
CROSS JOIN LATERAL (
    SELECT "id" FROM "public"."ConstructionType" WHERE "name" = '解体' AND "isActive" = true LIMIT 1
) ct
WHERE pm."subcontractorDemolitionCost" IS NOT NULL
  AND pm."subcontractorDemolitionCost" > 0
ON CONFLICT DO NOTHING;

-- レガシー列を削除
ALTER TABLE "public"."ProjectMaster"
    DROP COLUMN "subcontractorCost",
    DROP COLUMN "subcontractorAssemblyCost",
    DROP COLUMN "subcontractorDemolitionCost";
