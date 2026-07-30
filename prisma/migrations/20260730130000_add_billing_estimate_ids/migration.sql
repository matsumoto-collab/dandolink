-- 請求待ちボードの見積金額を「常に見積書に追従」させるための列。
-- 従来は「見積金額に設定」ピッカーの結果を ProjectMaster.contractAmount に金額スナップショットとして
-- 保存し、それをボードが最優先していたため、見積書を修正してもボードの見積金額が古いままだった。
-- 今後は「どの見積を使うか」だけを billingEstimateIds（見積IDの文字列配列）に記憶し、
-- 金額は毎回 Estimate.subtotal（税抜）の現在値から計算する。
-- NULL / 空配列 = 未選択（従来どおり 見積1件=その見積 / 複数=contractAmount互換 / 0件=contractAmount で解決）。
-- 既存の contractAmount は残置（複数見積案件の旧スナップショット互換・再選択すれば追従に移行する）。

-- AlterTable
ALTER TABLE "public"."ProjectMaster" ADD COLUMN "billingEstimateIds" JSONB;
