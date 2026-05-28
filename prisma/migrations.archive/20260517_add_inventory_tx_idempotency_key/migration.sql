-- C10（#4 解消 / 在庫リワーク Phase 3 是正 round-2）
-- InventoryTransaction の冪等を「アプリ層 read-then-write」だけでなく
-- DB 制約で強制する。並行重複 INSERT を DB レベルで拒否する構造へ。
--
-- 設計（ナイーブ unique が不可な理由）:
--   単純な UNIQUE(referenceId, materialItemId, referenceType) は
--   forward → reversal → 再 forward（loaded items 差替の正規フロー）を
--   壊す（再 forward が衝突して入らなくなる）。
--   そこで「同一適用世代」を一意化する決定論的キー idempotencyKey を導入する:
--     idempotencyKey = `<referenceId>:<materialItemId>:<direction>:<generation>`
--   generation は当該 referenceId+item の forward/reversal サイクル数を
--   既存台帳から決定論的に算出した世代番号。
--   - 並行重複（同一適用の二重 INSERT）: 同一 generation → 同一キー →
--     部分 unique 違反で 2 本目以降が DB に拒否される。
--   - 逆仕訳後の正当な再 forward: generation が進む → 別キー → 許容される。
--   棚卸し調整など台帳外の Tx は idempotencyKey = NULL とし、
--   部分 unique（WHERE idempotencyKey IS NOT NULL）の対象外にする。
--
-- 対象 DB はデータゼロ（クリーン再構築前提）のため列追加・index 追加は安全。

-- AlterTable
ALTER TABLE "public"."InventoryTransaction"
    ADD COLUMN "idempotencyKey" TEXT;

-- 部分 unique 制約（idempotencyKey が非 NULL の行のみ一意）。
-- Prisma の @@unique は部分 index（WHERE 句付き）を表現できないため
-- 生 SQL で CREATE UNIQUE INDEX ... WHERE を発行する。
-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_idempotencyKey_key"
    ON "public"."InventoryTransaction" ("idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL;
