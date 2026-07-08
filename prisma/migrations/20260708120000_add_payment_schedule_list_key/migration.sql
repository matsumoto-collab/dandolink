-- 支払リストを同一支払日で複数持てるようにするグループキーを追加。
-- 既存データは支払日ごとに1リストとしてバックフィル（従来のグルーピングと同じ見え方を維持）。
ALTER TABLE "PaymentSchedule" ADD COLUMN "listKey" TEXT;

-- MATERIALIZED で gen_random_uuid() の評価を「支払日ごとに1回」に固定する
WITH d AS MATERIALIZED (
    SELECT "paymentDate", gen_random_uuid()::text AS "key"
    FROM (SELECT DISTINCT "paymentDate" FROM "PaymentSchedule") AS dates
)
UPDATE "PaymentSchedule" AS ps
SET "listKey" = d."key"
FROM d
WHERE ps."paymentDate" = d."paymentDate";

CREATE INDEX "PaymentSchedule_listKey_idx" ON "PaymentSchedule"("listKey");
