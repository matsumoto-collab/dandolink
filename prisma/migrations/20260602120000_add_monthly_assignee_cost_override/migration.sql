-- CreateTable
-- 利益ダッシュボードの月次・案件担当者別「原価」手修正（上書き）値。
-- 既定は日報・配置から自動算出し、行が在ればその月・担当者の原価を上書きする。
-- assigneeId は User.id（担当者未設定ぶんは '__unassigned__' センチネル。FK は張らない）。
CREATE TABLE "public"."MonthlyAssigneeCostOverride" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyAssigneeCostOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyAssigneeCostOverride_year_month_idx" ON "public"."MonthlyAssigneeCostOverride"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyAssigneeCostOverride_year_month_assigneeId_key" ON "public"."MonthlyAssigneeCostOverride"("year", "month", "assigneeId");
