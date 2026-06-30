-- CreateTable
-- 請求判断ボードの「案件 × 締め基準月(periodKey=YYYY-MM)」ごとの請求判断。
-- 'pending'(判断待ち) は行を作らない（レコード無し＝判断待ち）。月をまたいで判断が貼り付かないようにする。
-- projectMasterId は ProjectMaster.id（FK は張らない＝集計専用の軽量テーブル）。
CREATE TABLE "public"."ProjectBillingDecision" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBillingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBillingDecision_periodKey_idx" ON "public"."ProjectBillingDecision"("periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBillingDecision_projectMasterId_periodKey_key" ON "public"."ProjectBillingDecision"("projectMasterId", "periodKey");

-- Backfill: 既存の案件単位の請求判断(pending以外)を「当月(JST)締め分」の判断として移行する。
-- 旧 ProjectMaster.billingDecision は残置（revert保険・移行のバックフィル元）。当月の periodKey に1行ずつ INSERT。
-- 注意: 当月は「適用した瞬間のJST月」。月末跨ぎで periodKey が変わるため、意図する月内に適用すること。
INSERT INTO "public"."ProjectBillingDecision"
    ("id", "projectMasterId", "periodKey", "decision", "decidedBy", "decidedAt", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    "id",
    to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM'),
    "billingDecision",
    "billingDecisionBy",
    "billingDecisionAt",
    now(),
    now()
FROM "public"."ProjectMaster"
WHERE "billingDecision" IS NOT NULL AND "billingDecision" <> 'pending'
ON CONFLICT ("projectMasterId", "periodKey") DO NOTHING;
