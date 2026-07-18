-- スケジュール「仮予定・浮き」管理 Phase 0a（仮予定・浮き管理_AI照会_実装設計書 v1.4）。
-- 仮予定 = 改修工事などで先方未確定のまま経験則で仮押さえした配置。
--   dateStatus: 'confirmed'（確定・既定）| 'tentative'（仮）。isDispatchConfirmed（社内手配確定）とは別概念。
--   confirmDueDate: 仮予定の「この日までに先方へ確認する」目安日（JST 0時規約）。
-- tentativeConfirmLeadDays: 確認予定日の自動提案「予定日の◯日前」。担当者ごとに感覚が違うため User に持つ。
-- 既存データは全行 confirmed で開始し、リリース時に各管理者が仕分けビューで一巡する。

-- AlterTable
ALTER TABLE "public"."ProjectAssignment" ADD COLUMN "dateStatus" TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE "public"."ProjectAssignment" ADD COLUMN "confirmDueDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN "tentativeConfirmLeadDays" INTEGER NOT NULL DEFAULT 14;
