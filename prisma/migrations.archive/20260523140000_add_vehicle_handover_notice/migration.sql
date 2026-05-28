-- 車両引き継ぎ通知の差分管理表を追加する。
-- 関連: 協力業者車両_閲覧権限と引き継ぎ通知_実装指示.md §4-3
-- 適用: kei の明示指示があるまで本番 DB へ流さないこと（feedback_deploy_confirmation）。
--
-- 当面の運用は prisma db push でスキーマを反映する想定だが、
-- 直接 psql で当てる場合のため SQL を保管しておく。

-- CreateTable
CREATE TABLE "public"."VehicleHandoverNotice" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fromAssignmentId" TEXT NOT NULL,
    "toAssignmentId" TEXT NOT NULL,
    "notifiedUserIds" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "VehicleHandoverNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleHandoverNotice_vehicleId_canceledAt_idx"
    ON "public"."VehicleHandoverNotice"("vehicleId", "canceledAt");

-- CreateIndex
CREATE INDEX "VehicleHandoverNotice_fromAssignmentId_idx"
    ON "public"."VehicleHandoverNotice"("fromAssignmentId");

-- CreateIndex
CREATE INDEX "VehicleHandoverNotice_toAssignmentId_idx"
    ON "public"."VehicleHandoverNotice"("toAssignmentId");
