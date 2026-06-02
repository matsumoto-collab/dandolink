-- AlterTable
-- 顧客ごとの請求締め日（0=末締め / それ以外は締め日: 5,10,15,20,25 等）。
-- 既定 0（末締め）・追加カラムのみ＝後方互換。請求ボードが顧客の締め日で期間を区切るために使用する。
ALTER TABLE "public"."Customer" ADD COLUMN "closingDay" INTEGER NOT NULL DEFAULT 0;
