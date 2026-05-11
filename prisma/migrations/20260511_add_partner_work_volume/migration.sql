-- 協力業者出来高表
-- partner ロールの会社単位で月次の出来高（現場一覧と金額）を管理する
-- 配置(ProjectAssignment)から自動生成された行と、admin が手動追加した行をマージして扱う
-- sourceAssignmentId をユニークにすることで、配置1件につき1行までしか保存できない

CREATE TABLE "public"."PartnerWorkVolume" (
    "id" TEXT NOT NULL,
    "partnerCompanyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "customerName" TEXT,
    "projectMasterId" TEXT,
    "projectTitle" TEXT NOT NULL,
    "managerName" TEXT,
    "constructionContent" TEXT,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "sourceAssignmentId" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PartnerWorkVolume_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerWorkVolume_sourceAssignmentId_key"
  ON "public"."PartnerWorkVolume"("sourceAssignmentId");

CREATE INDEX "PartnerWorkVolume_partnerCompanyId_date_idx"
  ON "public"."PartnerWorkVolume"("partnerCompanyId", "date");

CREATE INDEX "PartnerWorkVolume_date_idx"
  ON "public"."PartnerWorkVolume"("date");
