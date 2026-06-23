-- 案件一覧「請求」列の手動上書き（'unbilled' | 'partial' | 'full'）。
-- null / 未設定 = 契約金額（contractAmount）ベースの自動判定。
ALTER TABLE "ProjectMaster" ADD COLUMN "billingStatusOverride" TEXT;
