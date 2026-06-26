-- 外注費の手入力分（協力業者の手配確定からの自動計上に無い外注費の受け皿）。
-- 既存の subcontractorCosts（工事種別ごとの外注単価マスタ＝複数形リレーション）とは別物。
-- null / 未設定 = 0。原価エンジンは「協力業者の自動計上 + この手入力分」で合算する。
ALTER TABLE "public"."ProjectMaster" ADD COLUMN "subcontractorExpense" DECIMAL(12,2);
