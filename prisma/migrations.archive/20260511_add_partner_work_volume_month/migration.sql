-- 協力業者出来高の月別ステータス管理
-- status: 'draft' (編集中、partner 非表示) / 'completed' (完了、partner 閲覧可能)

CREATE TABLE "public"."PartnerWorkVolumeMonth" (
    "id" TEXT NOT NULL,
    "partnerCompanyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerWorkVolumeMonth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerWorkVolumeMonth_partnerCompanyId_year_month_key"
  ON "public"."PartnerWorkVolumeMonth"("partnerCompanyId", "year", "month");

CREATE INDEX "PartnerWorkVolumeMonth_partnerCompanyId_idx"
  ON "public"."PartnerWorkVolumeMonth"("partnerCompanyId");
