-- 安全書類: 資格・教育に番号と資格証画像を追加（kei要望 2026-06-11）
-- 適用: npx prisma db execute --file docs/manual-migrations/2026-06-11_add_qualification_number_image.sql --schema prisma/schema.prisma
-- licenseNumber は修了証・免許証の番号（§7.4 の禁止対象＝健康保険記号番号・基礎年金番号・マイナンバーとは異なり記載可）。
-- 画像は Supabase Storage（project-master-files バケット）qualifications/{profileId}/ 配下。DBはパスのみ保持。

ALTER TABLE "public"."WorkerQualification"
    ADD COLUMN "licenseNumber" TEXT,
    ADD COLUMN "imagePath" TEXT,
    ADD COLUMN "imageThumbPath" TEXT;
