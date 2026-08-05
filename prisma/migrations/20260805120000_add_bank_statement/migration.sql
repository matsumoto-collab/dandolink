-- CreateTable
-- 銀行入金明細のファイル保管庫（現金出納帳ページ内の「銀行入金明細」タブ）。
-- AI読み取りやデータ化はせず、月別にファイル（画像/PDF/CSV）を貼るだけの置き場。
-- 閲覧・編集は User.canAccessCashbook を持つユーザーのみ（現金出納帳と同じ個別許可制）。
-- 原価計算・利益計算・入金消込とは完全に独立（連携しない）。
CREATE TABLE "public"."BankStatement" (
    "id" TEXT NOT NULL,
    "targetMonth" TEXT NOT NULL,
    "memo" TEXT,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "signedUrl" TEXT,
    "signedUrlExpiresAt" TIMESTAMP(3),
    "thumbnailSignedUrl" TEXT,
    "thumbnailSignedUrlExpiresAt" TIMESTAMP(3),
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatement_targetMonth_idx" ON "public"."BankStatement"("targetMonth");

-- CreateIndex
CREATE INDEX "BankStatement_createdAt_idx" ON "public"."BankStatement"("createdAt");
