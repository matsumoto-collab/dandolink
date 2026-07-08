-- 現金出納帳に精算方法（現金/振込）を追加。null=現金扱い（既存データはすべて現金精算）。
-- 振込精算の行は現金が動いていないため、差引残高・前月繰越の計算から除外する。
ALTER TABLE "CashbookEntry" ADD COLUMN "settleMethod" TEXT;
