# 手動適用マイグレーション履歴

prisma migrate dev / migrate deploy を経由せず、
`prisma db execute` で直接 DB に適用した SQL の記録置き場。

既存スキーマと本番 DB のドリフトが大きいため、ドリフト全体の解消は
別タスクとし、新規追加のみを最小 SQL で当てる方針を取っている。

## 履歴

| 日付 | ファイル | 内容 |
|---|---|---|
| 2026-05-06 | 2026-05-06_add_site_survey.sql | SiteSurvey テーブル新規作成 + INDEX 2件 + ProjectMaster への FK |
| 2026-06-11 | 2026-06-11_add_safety_documents.sql | 安全書類 Phase1: WorkerSafetyProfile（CHECK排他制約付き）/ WorkerQualification / SafetyDocument 新規作成 + INDEX + FK |
