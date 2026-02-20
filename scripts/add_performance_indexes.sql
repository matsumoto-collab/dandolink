-- DandoLink パフォーマンス改善用インデックス
-- Supabaseダッシュボードの SQL Editor で実行してください

-- =========================================
-- ProjectAssignment テーブル
-- =========================================

-- 日付でのクエリを高速化（週間カレンダー表示用）
CREATE INDEX IF NOT EXISTS idx_assignment_date 
ON "ProjectAssignment"(date);

-- 職長ID + 日付での複合インデックス（職長ごとのスケジュール表示用）
CREATE INDEX IF NOT EXISTS idx_assignment_employee_date 
ON "ProjectAssignment"("assignedEmployeeId", date);

-- 案件マスターIDでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_assignment_project_master 
ON "ProjectAssignment"("projectMasterId");

-- =========================================
-- Customer テーブル
-- =========================================

-- 顧客名での検索を高速化
CREATE INDEX IF NOT EXISTS idx_customer_name 
ON "Customer"(name);

-- =========================================
-- Estimate テーブル
-- =========================================

-- 作成日でのソートを高速化（一覧表示用）
CREATE INDEX IF NOT EXISTS idx_estimate_created 
ON "Estimate"("createdAt" DESC);

-- ステータスでのフィルタリングを高速化
CREATE INDEX IF NOT EXISTS idx_estimate_status 
ON "Estimate"(status);

-- =========================================
-- ProjectMaster テーブル
-- =========================================

-- タイトルでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_project_master_title 
ON "ProjectMaster"(title);

-- 顧客IDでの検索を高速化
CREATE INDEX IF NOT EXISTS idx_project_master_customer 
ON "ProjectMaster"("customerId");

-- =========================================
-- 確認用クエリ
-- =========================================

-- 作成したインデックスを確認するには以下を実行:
-- SELECT indexname, tablename FROM pg_indexes 
-- WHERE schemaname = 'public' 
-- ORDER BY tablename, indexname;
