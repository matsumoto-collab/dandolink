-- 「人工あたり加工高」の判定に使う設定を自社情報（SystemSettings）に追加する。
-- 列追加のみ。既存列の削除・型変更・データ更新は行わない。
--
-- ・breakevenValueAddedPerManday … 損益分岐の人工単価（円）。手入力。NULL = 未設定＝判定色を出さない
-- ・outsourcingRatioThreshold    … 「外注中心」と判定する労務の外注比率
--                                   ＝ 外注費 ÷（外注費 ＋ 自社人件費）。既定 0.50
-- ・billingShortRatio            … 請求不足を疑う 請求額÷見積額。既定 0.70
-- ・judgeWarningRatio            … 黄色（注意）判定の下限。既定 0.80

ALTER TABLE "public"."SystemSettings"
    ADD COLUMN IF NOT EXISTS "breakevenValueAddedPerManday" INTEGER,
    ADD COLUMN IF NOT EXISTS "outsourcingRatioThreshold" DECIMAL(4,3) NOT NULL DEFAULT 0.500,
    ADD COLUMN IF NOT EXISTS "billingShortRatio" DECIMAL(4,3) NOT NULL DEFAULT 0.700,
    ADD COLUMN IF NOT EXISTS "judgeWarningRatio" DECIMAL(4,3) NOT NULL DEFAULT 0.800;
