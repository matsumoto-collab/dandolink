-- 社内カレンダー機能（admin / manager 限定）
-- 現調・打ち合わせ・道路使用許可の予定を管理する CalendarEvent テーブルと、
-- ProjectMaster への道路使用許可日付フィールドを追加する。

-- 1. ProjectMaster へ道路使用許可関連のフィールドを追加
ALTER TABLE "public"."ProjectMaster"
    ADD COLUMN IF NOT EXISTS "roadPermitCompletionDate" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "roadPermitReceiveDate" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "roadPermitExpiryDate" TIMESTAMP(3);

-- 2. CalendarEvent テーブル本体
CREATE TABLE IF NOT EXISTS "public"."CalendarEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "color" TEXT,
    "createdBy" TEXT NOT NULL,
    "projectMasterId" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- 3. 参照整合性: ProjectMaster 削除時は NULL に
ALTER TABLE "public"."CalendarEvent"
    ADD CONSTRAINT "CalendarEvent_projectMasterId_fkey"
    FOREIGN KEY ("projectMasterId")
    REFERENCES "public"."ProjectMaster"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- 4. インデックス
CREATE INDEX IF NOT EXISTS "CalendarEvent_startAt_idx"
    ON "public"."CalendarEvent"("startAt");
CREATE INDEX IF NOT EXISTS "CalendarEvent_createdBy_idx"
    ON "public"."CalendarEvent"("createdBy");
CREATE INDEX IF NOT EXISTS "CalendarEvent_projectMasterId_idx"
    ON "public"."CalendarEvent"("projectMasterId");
CREATE INDEX IF NOT EXISTS "CalendarEvent_category_idx"
    ON "public"."CalendarEvent"("category");
CREATE INDEX IF NOT EXISTS "CalendarEvent_visibility_startAt_idx"
    ON "public"."CalendarEvent"("visibility", "startAt");
