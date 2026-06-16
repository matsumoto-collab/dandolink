-- 仕入請求書に振込先口座情報カラムを追加。
-- AIが請求書から読み取る（または手修正する）口座情報を保持し、確定時に振込先マスター(Payee)へ登録/再利用する。
ALTER TABLE "public"."PurchaseInvoice" ADD COLUMN "payeeKana" TEXT,
ADD COLUMN "bankName" TEXT,
ADD COLUMN "branchName" TEXT,
ADD COLUMN "accountType" TEXT,
ADD COLUMN "accountNumber" TEXT,
ADD COLUMN "accountHolder" TEXT;
