-- スケジュール変更履歴テーブル
-- カレンダーで案件をドラッグ移動した際の履歴(日付・職長変更)を記録する。
-- 閲覧は admin / manager のみ (API側で制御)

CREATE TABLE IF NOT EXISTS "public"."ScheduleChangeHistory" (
    "id"            TEXT NOT NULL,
    "assignmentId"  TEXT NOT NULL,
    "changedById"   TEXT NOT NULL,
    "changedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeType"    TEXT NOT NULL,
    "previousValue" TEXT NOT NULL,
    "newValue"      TEXT NOT NULL,

    CONSTRAINT "ScheduleChangeHistory_pkey" PRIMARY KEY ("id")
);

-- ProjectAssignment 削除時はカスケード削除
ALTER TABLE "public"."ScheduleChangeHistory"
    ADD CONSTRAINT "ScheduleChangeHistory_assignmentId_fkey"
    FOREIGN KEY ("assignmentId")
    REFERENCES "public"."ProjectAssignment"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- インデックス
CREATE INDEX IF NOT EXISTS "ScheduleChangeHistory_changedAt_idx"
    ON "public"."ScheduleChangeHistory"("changedAt");
CREATE INDEX IF NOT EXISTS "ScheduleChangeHistory_assignmentId_idx"
    ON "public"."ScheduleChangeHistory"("assignmentId");
CREATE INDEX IF NOT EXISTS "ScheduleChangeHistory_changedById_idx"
    ON "public"."ScheduleChangeHistory"("changedById");
