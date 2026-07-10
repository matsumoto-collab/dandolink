-- AlterTable
-- カードレシート受け箱に通貨コードを追加（null=円、'USD' 等）。
-- ドル建てレシート（Supabase/Vercel 等のサブスク）は金額をその通貨の値のまま持ち、
-- 明細行との照合は外貨金額（CardStatementLine.foreignAmount）と突き合わせる。
ALTER TABLE "public"."CardReceipt" ADD COLUMN "currency" TEXT;
