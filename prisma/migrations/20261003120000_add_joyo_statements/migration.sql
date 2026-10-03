-- 支払明細書（常用で来ている一人親方向け）を保存できるようにする。
--
-- テーブルを3つ足すだけ。既存のテーブル・列・データには一切触らない。
--   1. JoyoContractor         … 対象者（出勤簿のユーザーと 1:1。宛名・単価・振込先）
--   2. JoyoStatement          … 支払明細書（対象者 × 対象月で1件）
--   3. JoyoStatementSettings  … 書類の名前・注意書き（1行だけ。行が無くても既定値で動く）
-- 何度流しても同じ結果になる（IF NOT EXISTS）。

-- 1. 対象者 -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."JoyoContractor" (
    "id"                 TEXT NOT NULL,
    "userId"             TEXT NOT NULL,
    "code"               INTEGER NOT NULL,
    "recipientName"      TEXT NOT NULL,
    "honorific"          TEXT NOT NULL DEFAULT '御中',
    "postalCode"         TEXT,
    "address"            TEXT,
    "registrationNumber" TEXT,
    "unitPrice"          INTEGER NOT NULL DEFAULT 0,
    "payeeId"            TEXT,
    "sortOrder"          INTEGER NOT NULL DEFAULT 0,
    "isActive"           BOOLEAN NOT NULL DEFAULT true,
    "notes"              TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy"          TEXT,
    CONSTRAINT "JoyoContractor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JoyoContractor_userId_key"
    ON "public"."JoyoContractor" ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "JoyoContractor_code_key"
    ON "public"."JoyoContractor" ("code");
CREATE INDEX IF NOT EXISTS "JoyoContractor_isActive_sortOrder_idx"
    ON "public"."JoyoContractor" ("isActive", "sortOrder");

-- 2. 支払明細書 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."JoyoStatement" (
    "id"                TEXT NOT NULL,
    "contractorId"      TEXT NOT NULL,
    "year"              INTEGER NOT NULL,
    "month"             INTEGER NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'draft',
    "statementNo"       TEXT,
    "issueDate"         DATE NOT NULL,
    "paymentDate"       DATE NOT NULL,
    "subject"           TEXT NOT NULL DEFAULT '',
    "items"             JSONB NOT NULL,
    "total"             INTEGER NOT NULL DEFAULT 0,
    "tax"               INTEGER NOT NULL DEFAULT 0,
    "includeAttendance" BOOLEAN NOT NULL DEFAULT true,
    "attendanceCounts"  JSONB,
    "issuedSnapshot"    JSONB,
    "issuedAt"          TIMESTAMP(3),
    "issuedBy"          TEXT,
    "paymentScheduleId" TEXT,
    "notes"             TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy"         TEXT,
    CONSTRAINT "JoyoStatement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "JoyoStatement_contractorId_year_month_key"
    ON "public"."JoyoStatement" ("contractorId", "year", "month");
CREATE INDEX IF NOT EXISTS "JoyoStatement_year_month_idx"
    ON "public"."JoyoStatement" ("year", "month");

-- 明細が1件でもある対象者は消せない（対象者は「利用中」を外して残す）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JoyoStatement_contractorId_fkey') THEN
        ALTER TABLE "public"."JoyoStatement"
            ADD CONSTRAINT "JoyoStatement_contractorId_fkey"
            FOREIGN KEY ("contractorId") REFERENCES "public"."JoyoContractor"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. 共通設定 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."JoyoStatementSettings" (
    "id"         TEXT NOT NULL DEFAULT 'default',
    "title"      TEXT NOT NULL DEFAULT '支払明細書',
    "footerNote" TEXT NOT NULL DEFAULT '',
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy"  TEXT,
    CONSTRAINT "JoyoStatementSettings_pkey" PRIMARY KEY ("id")
);
