-- 領収書に精算（立替者への支払い）状況フラグを追加。仕分け（費目分類）とは独立。
-- AlterTable
ALTER TABLE "public"."Receipt" ADD COLUMN "settled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."Receipt" ADD COLUMN "settledAt" TIMESTAMP(3);
ALTER TABLE "public"."Receipt" ADD COLUMN "settledBy" TEXT;

-- CreateIndex
CREATE INDEX "Receipt_settled_idx" ON "public"."Receipt"("settled");
