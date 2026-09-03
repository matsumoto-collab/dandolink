-- 受注明細書（信用保証協会様式）を保存できるようにする。
-- 既存データには一切触らない（列追加とテーブル追加のみ）。

-- 1) 顧客の入金サイト。請求書の期日プリセット（lib/closingDay.ts DueDatePreset）と同じ値。
--    NULL = 未設定＝'nextMonthEnd'（翌月末）として扱う。
ALTER TABLE "public"."Customer" ADD COLUMN IF NOT EXISTS "paymentDuePreset" TEXT;

-- 2) 提出1回分。金額はすべて円で持ち、出力時に千円へ丸める。
CREATE TABLE IF NOT EXISTS "public"."OrderBacklogReport" (
    "id" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "title" TEXT,
    "applicantName" TEXT,
    "individualThreshold" INTEGER NOT NULL DEFAULT 1000000,
    "unreceivedMode" TEXT NOT NULL DEFAULT 'remaining',
    "taxMode" TEXT NOT NULL DEFAULT 'inclusive',
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderBacklogReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderBacklogReport_asOfDate_idx"
    ON "public"."OrderBacklogReport"("asOfDate");

-- 3) 1案件ぶんの明細行。区分集約（その他仮設工事 N件…）は保存せず表示時に計算する。
--    projectMasterId は論理FK（案件を消しても提出済みの行は残す）。
CREATE TABLE IF NOT EXISTS "public"."OrderBacklogReportLine" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "projectMasterId" TEXT,
    "customerName" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "workKind" TEXT NOT NULL DEFAULT 'temp',
    "siteKind" TEXT NOT NULL DEFAULT 'other',
    "contractAmount" INTEGER NOT NULL DEFAULT 0,
    "startYm" TEXT,
    "endYm" TEXT,
    "progressRate" INTEGER NOT NULL DEFAULT 0,
    "receivedAmount" INTEGER NOT NULL DEFAULT 0,
    "schedule" JSONB,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    CONSTRAINT "OrderBacklogReportLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderBacklogReportLine_reportId_idx"
    ON "public"."OrderBacklogReportLine"("reportId");
CREATE INDEX IF NOT EXISTS "OrderBacklogReportLine_projectMasterId_idx"
    ON "public"."OrderBacklogReportLine"("projectMasterId");

-- 提出1回分を消したら明細行も消す
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OrderBacklogReportLine_reportId_fkey'
    ) THEN
        ALTER TABLE "public"."OrderBacklogReportLine"
            ADD CONSTRAINT "OrderBacklogReportLine_reportId_fkey"
            FOREIGN KEY ("reportId") REFERENCES "public"."OrderBacklogReport"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
