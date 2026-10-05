-- 手当: 記録の金額を、管理者が手で直せるようにする（kei 決定 2026-10-05）
--
-- 目的: 1人・1日の手当の記録の金額を、管理者が手で直したことを残す
--       （手で直した記録の金額は、あとで金額の表を変えても変えない）。
--
-- AllowanceRecord に、空でよい列を3つ足すだけ。既存の列・行・ほかのテーブルは変えない
-- （すでにある記録は、3つとも NULL ＝「手で直していない」）。
--   amountEditedAt      … 金額を手で直した日時（NULL = 手で直していない）
--   amountEditedBy      … 直した人（User.id）
--   amountEditedByName  … 直した人の、その時点の名前の写し
-- 何度流しても同じ結果になる。
ALTER TABLE "public"."AllowanceRecord" ADD COLUMN IF NOT EXISTS "amountEditedAt" TIMESTAMP(3);
ALTER TABLE "public"."AllowanceRecord" ADD COLUMN IF NOT EXISTS "amountEditedBy" TEXT;
ALTER TABLE "public"."AllowanceRecord" ADD COLUMN IF NOT EXISTS "amountEditedByName" TEXT;
