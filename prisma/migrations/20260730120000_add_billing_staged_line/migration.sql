-- 請求待ちボードの「請求対象（staged）」をDBに永続化する。
-- 以前はクライアントの useState だけで保持していたため、別メニューへ移動すると選択が消えていた。
-- 案件1件につき1行（projectMasterId が一意）＝上書き（upsert）で最新の選択内容を保持し、
-- 請求書を発行したら該当行を削除する。FK は張らない（ProjectBillingDecision に倣う軽量テーブル）。

-- CreateTable
CREATE TABLE "public"."BillingStagedLine" (
    "id" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "stagedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingStagedLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingStagedLine_projectMasterId_key" ON "public"."BillingStagedLine"("projectMasterId");

-- CreateIndex
CREATE INDEX "BillingStagedLine_customerId_idx" ON "public"."BillingStagedLine"("customerId");
