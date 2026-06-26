-- 各原価項目(人件費/車両費/材料費/積込費/その他/外注費)の「手入力分」を
-- 摘要(label)＋金額(amount)の複数明細で持つJSON。
-- 形式: {"labor":[{"label":"5月応援","amount":50000}], "vehicle":[...], "material":[...], "loading":[...], "other":[...], "subcontractor":[...]}
-- 既存の materialCost/loadingCost/otherExpenses/subcontractorExpense(単一スカラー)は後方互換で温存し、
-- 原価エンジンは manualCostItems の各bucketがあればその合計、無ければ旧スカラー列を採用する(未編集案件の金額は不変)。
ALTER TABLE "public"."ProjectMaster" ADD COLUMN "manualCostItems" JSONB;
