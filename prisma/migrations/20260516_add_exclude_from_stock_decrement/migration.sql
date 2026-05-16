-- AlterTable
-- ネット / シート / リース品など notes-JSON が出庫の正となる品目を
-- Phase 3 の倉庫在庫自動減算対象から外すための構造フラグ。
-- 既存行は false（通常どおり在庫減算対象）。クリーンDB前提で安全。
ALTER TABLE "public"."MaterialItem"
    ADD COLUMN "excludeFromStockDecrement" BOOLEAN NOT NULL DEFAULT false;
