-- CreateTable
-- 利益ダッシュボードの月次・案件別「原価」手修正（上書き）値。
-- 既定は日報・配置から自動算出し、行が在ればその月・案件の原価を上書きする。
-- projectId は ProjectMaster.id（FK は張らない＝集計専用の軽量テーブル）。
CREATE TABLE "public"."MonthlyProjectCostOverride" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyProjectCostOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyProjectCostOverride_year_month_idx" ON "public"."MonthlyProjectCostOverride"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyProjectCostOverride_year_month_projectId_key" ON "public"."MonthlyProjectCostOverride"("year", "month", "projectId");
