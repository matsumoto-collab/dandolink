-- AlterTable: 支払予定に口座名義を追加
ALTER TABLE "public"."PaymentSchedule" ADD COLUMN "accountHolder" TEXT;
