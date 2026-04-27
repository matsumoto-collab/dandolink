-- 旧スキーマを破棄して新スキーマで再作成（旧テーブルは未使用のため drop+create）
DROP TABLE IF EXISTS "AttendanceRecord";

CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "foremanId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'present',
    "earlyStartMinutes" INTEGER NOT NULL DEFAULT 0,
    "morningLoadingMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "eveningLoadingMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyEndTime" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");
CREATE INDEX "AttendanceRecord_userId_idx" ON "AttendanceRecord"("userId");
CREATE INDEX "AttendanceRecord_foremanId_idx" ON "AttendanceRecord"("foremanId");
CREATE INDEX "AttendanceRecord_foremanId_date_idx" ON "AttendanceRecord"("foremanId", "date");
CREATE UNIQUE INDEX "AttendanceRecord_userId_date_key" ON "AttendanceRecord"("userId", "date");
