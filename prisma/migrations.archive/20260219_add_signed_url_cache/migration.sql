-- AlterTable: ProjectMasterFile に署名付きURLキャッシュ用カラムを追加
ALTER TABLE "public"."ProjectMasterFile" ADD COLUMN "signedUrl" TEXT;
ALTER TABLE "public"."ProjectMasterFile" ADD COLUMN "signedUrlExpiresAt" TIMESTAMP(3);
