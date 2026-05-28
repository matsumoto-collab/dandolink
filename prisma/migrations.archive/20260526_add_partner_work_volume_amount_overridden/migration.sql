-- 協力業者出来高: ユーザーが明示的に金額を設定したことを記録するフラグ
-- true のとき GET の amount=0 自動再算出をスキップし、ユーザーが入力した 0 を維持する。
-- 既存行は default=false なので従来の挙動（amount=0 → 案件マスタから再算出）を維持。
ALTER TABLE "public"."PartnerWorkVolume"
  ADD COLUMN "amountOverridden" BOOLEAN NOT NULL DEFAULT false;
