-- 工具の持出し管理（在庫管理メニュー内「持出しリスト」）。
-- 共有工具を「誰がどの現場に持って行っているか」「修理中か」で把握するための機能。
-- ToolCategory: 工具の種類マスタ（設定画面から自由に追加・削除。削除は isActive=false の論理削除）。
-- Tool: 工具の個体（1台 = 1レコード）。現在の状態と持出し先を保持する。
-- ToolCheckoutLog: 持出し・返却・状態変更の履歴。案件名/氏名は当時の記録としてスナップショットで残す。
-- 閲覧は全ロール（協力会社は閲覧のみ）、持出し/返却は社員、工具と種類の管理は admin/manager。
-- 在庫（MaterialItem.stockQuantity）・原価計算・支払予定には一切連携しない。

-- CreateTable
CREATE TABLE "public"."ToolCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tool" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "projectMasterId" TEXT,
    "destinationNote" TEXT,
    "holderId" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ToolCheckoutLog" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "projectMasterId" TEXT,
    "projectName" TEXT,
    "destinationNote" TEXT,
    "holderId" TEXT,
    "holderName" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCheckoutLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolCategory_name_idx" ON "public"."ToolCategory"("name");

-- CreateIndex
CREATE INDEX "ToolCategory_sortOrder_idx" ON "public"."ToolCategory"("sortOrder");

-- CreateIndex
CREATE INDEX "Tool_categoryId_idx" ON "public"."Tool"("categoryId");

-- CreateIndex
CREATE INDEX "Tool_status_idx" ON "public"."Tool"("status");

-- CreateIndex
CREATE INDEX "Tool_projectMasterId_idx" ON "public"."Tool"("projectMasterId");

-- CreateIndex
CREATE INDEX "Tool_holderId_idx" ON "public"."Tool"("holderId");

-- CreateIndex
CREATE INDEX "ToolCheckoutLog_toolId_idx" ON "public"."ToolCheckoutLog"("toolId");

-- CreateIndex
CREATE INDEX "ToolCheckoutLog_createdAt_idx" ON "public"."ToolCheckoutLog"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."Tool" ADD CONSTRAINT "Tool_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."ToolCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ToolCheckoutLog" ADD CONSTRAINT "ToolCheckoutLog_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "public"."Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
