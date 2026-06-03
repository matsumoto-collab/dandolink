-- CreateTable
-- 配置の物理削除を「元に戻す」ためのスナップショット控え。
-- 削除時に配置の全項目を JSON(snapshot) に退避し、復元時は新規配置として再作成する。
-- ProjectAssignment への FK は張らない（配置が消えてもこの行は残す＝カスケードで消えないため）。
CREATE TABLE "public"."DeletedAssignmentLog" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "projectMasterId" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "deletedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    "restoredById" TEXT,

    CONSTRAINT "DeletedAssignmentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletedAssignmentLog_deletedAt_idx" ON "public"."DeletedAssignmentLog"("deletedAt");

-- CreateIndex
CREATE INDEX "DeletedAssignmentLog_projectMasterId_idx" ON "public"."DeletedAssignmentLog"("projectMasterId");
