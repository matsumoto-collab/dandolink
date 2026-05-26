-- 協力会社ごとの請求税区分 (税別 / 税込)
-- 出来高表のフッターと PDF で「小計(税抜)/消費税/合計(税込)」表示を切り替えるために使う。
-- 既存ユーザーは全て従来通りの税別 ('exclusive') として扱う。
ALTER TABLE "public"."User"
  ADD COLUMN "partnerTaxMode" TEXT NOT NULL DEFAULT 'exclusive';
