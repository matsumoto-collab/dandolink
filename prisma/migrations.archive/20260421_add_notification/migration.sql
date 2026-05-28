-- ユーザー別の通知履歴テーブル
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_createdAt_idx"
    ON "public"."Notification"("userId", "createdAt" DESC);
CREATE INDEX "Notification_userId_readAt_idx"
    ON "public"."Notification"("userId", "readAt");

-- Supabase Realtime 対象テーブルに追加（未読バッジの即時反映）
ALTER PUBLICATION supabase_realtime ADD TABLE "public"."Notification";

-- ロールバック用SQL（必要な場合に手動で実行）:
-- ALTER PUBLICATION supabase_realtime DROP TABLE "public"."Notification";
-- DROP TABLE "public"."Notification";
