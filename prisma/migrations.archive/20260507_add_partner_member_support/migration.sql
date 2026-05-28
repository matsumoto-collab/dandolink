-- 協力会社メンバー機能サポート
-- User: companyId(自己参照FK, SET NULL), isLoginEnabled(NOT NULL DEFAULT true)
-- AssignmentWorker: workerId に index 追加
-- 既存データ非破壊（NOT NULLカラムにDEFAULT指定済 / 新規index追加のみ）

-- AlterTable: User に companyId / isLoginEnabled を追加
ALTER TABLE "public"."User"
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "isLoginEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex: User.companyId
CREATE INDEX "User_companyId_idx" ON "public"."User"("companyId");

-- CreateIndex: AssignmentWorker.workerId
CREATE INDEX "AssignmentWorker_workerId_idx" ON "public"."AssignmentWorker"("workerId");

-- AddForeignKey: User.companyId -> User.id (SET NULL on delete)
ALTER TABLE "public"."User"
  ADD CONSTRAINT "User_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "public"."User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
