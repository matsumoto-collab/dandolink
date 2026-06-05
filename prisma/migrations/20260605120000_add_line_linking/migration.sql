-- CreateTable
-- LINE公式アカウントと顧客担当者(Customer.contactPersons[].id)をひも付けるための一時連携コード。
-- 担当者ごとに発行し、顧客が友だち追加後にトークでこのコードを送ると Webhook が照合して lineUserId を確定する。
CREATE TABLE "public"."LineLinkToken" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lineUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "linkedAt" TIMESTAMP(3),

    CONSTRAINT "LineLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- 顧客への完了連絡（LINE等）の送信履歴。二重送信防止・「送信済み」表示・監査に使う（Phase2で書き込み）。
CREATE TABLE "public"."CustomerNotificationLog" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "contactId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'line',
    "milestone" TEXT,
    "lineUserId" TEXT,
    "messageText" TEXT,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "errorText" TEXT,
    "sentBy" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LineLinkToken_code_key" ON "public"."LineLinkToken"("code");

-- CreateIndex
CREATE INDEX "LineLinkToken_customerId_idx" ON "public"."LineLinkToken"("customerId");

-- CreateIndex
CREATE INDEX "LineLinkToken_status_idx" ON "public"."LineLinkToken"("status");

-- CreateIndex
CREATE INDEX "CustomerNotificationLog_assignmentId_idx" ON "public"."CustomerNotificationLog"("assignmentId");

-- CreateIndex
CREATE INDEX "CustomerNotificationLog_projectMasterId_idx" ON "public"."CustomerNotificationLog"("projectMasterId");
