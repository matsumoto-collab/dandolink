-- Web Push購読情報テーブル
CREATE TABLE "public"."PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key"
    ON "public"."PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx"
    ON "public"."PushSubscription"("userId");

-- ロールバック用SQL (必要な場合に手動で実行):
-- DROP TABLE "public"."PushSubscription";
