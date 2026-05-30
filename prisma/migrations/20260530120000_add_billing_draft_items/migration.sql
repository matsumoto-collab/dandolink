-- AlterTable
-- BillingDraft に複数明細（InvoiceItem[] の JSON 文字列）を保存する items 列を追加。
-- NULL 許容（既存行・旧モデルは null = 単一行 amount/title を使用、後方互換）。
ALTER TABLE "public"."BillingDraft" ADD COLUMN "items" TEXT;
