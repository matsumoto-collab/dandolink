-- スケジュール（日々の配置）で電動工具を車両と同じように選べるようにする。
-- 既存データには一切触らない（列追加とテーブル追加のみ）。
-- 工具そのもののマスタは機材台帳の Tool / ToolCategory をそのまま使う（設定画面の追加・削除も同じテーブル）。

-- 1) 配置に「予定の工具」と「手配確定した工具」を持たせる（どちらも Tool.id の JSON 配列）
ALTER TABLE "public"."ProjectAssignment" ADD COLUMN IF NOT EXISTS "tools" TEXT;
ALTER TABLE "public"."ProjectAssignment" ADD COLUMN IF NOT EXISTS "confirmedToolIds" TEXT;

-- 2) 配置 × 工具の行（AssignmentVehicle と同じ役割。機材台帳の使用履歴はここから導出する）
CREATE TABLE IF NOT EXISTS "public"."AssignmentTool" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    CONSTRAINT "AssignmentTool_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AssignmentTool_assignmentId_idx" ON "public"."AssignmentTool"("assignmentId");
CREATE INDEX IF NOT EXISTS "AssignmentTool_toolId_idx" ON "public"."AssignmentTool"("toolId");

-- 配置が消えたら紐づく行も消す（AssignmentVehicle と同じ）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentTool_assignmentId_fkey'
    ) THEN
        ALTER TABLE "public"."AssignmentTool"
            ADD CONSTRAINT "AssignmentTool_assignmentId_fkey"
            FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
