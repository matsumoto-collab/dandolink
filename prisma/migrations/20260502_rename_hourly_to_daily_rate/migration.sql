-- User: hourlyRate -> dailyRate
ALTER TABLE "User" RENAME COLUMN "hourlyRate" TO "dailyRate";
UPDATE "User" SET "dailyRate" = NULL;

-- Worker: hourlyRate -> dailyRate
ALTER TABLE "Worker" RENAME COLUMN "hourlyRate" TO "dailyRate";
UPDATE "Worker" SET "dailyRate" = NULL;

-- SystemSettings: laborDailyRate default 15000 -> 18000
ALTER TABLE "SystemSettings" ALTER COLUMN "laborDailyRate" SET DEFAULT 18000;
UPDATE "SystemSettings" SET "laborDailyRate" = 18000 WHERE "laborDailyRate" = 15000;
