-- AlterTable
-- ネット / シート / リース品など notes-JSON が出庫の正となる品目を
-- 倉庫在庫自動減算の対象から外すための構造フラグの「永続ミラー」。
--
-- 除外判定の権威は lib/materials/catalog.ts（コード）であり、Phase 3 の
-- 在庫増減 helper（lib/materials/stock.ts の applyStockChange）はその catalog を
-- 参照して判定する（C6 で統合した loading-list/confirm・inventory 棚卸し経路も
-- 同 helper 経由）。
-- 本 DB 列はその catalog 値を seed が片方向同期するミラーであり、
-- 在庫クエリ側で WHERE 強制に使える防御基盤（死蔵フラグではない）。
-- 既存行は false（通常どおり在庫減算対象）。クリーンDB前提で安全。
ALTER TABLE "public"."MaterialItem"
    ADD COLUMN "excludeFromStockDecrement" BOOLEAN NOT NULL DEFAULT false;
