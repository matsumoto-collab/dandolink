-- 請求書受け箱に支払種別を追加。
-- 口座振替（引落）の請求書では、記載の口座が「こちらの引落口座」なのに振込先として
-- 誤認識される問題への対応。AIが 振込/引落/払込用紙 を判定し、受け箱の表で変更できる。
-- 値は PaymentSchedule.paymentType と同じ（"transfer" | "direct_debit" | "payment_slip"）。

-- AlterTable
ALTER TABLE "public"."SupplierInvoice" ADD COLUMN "paymentType" TEXT NOT NULL DEFAULT 'transfer';
