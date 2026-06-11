-- 安全書類（グリーンファイル）Phase 1: 作業員安全プロフィール + 資格 + 書類本体
-- 要件: docs/SAFETY_DOCUMENTS_REQUIREMENTS.md v1.2
-- 適用: npx prisma db execute --file docs/manual-migrations/2026-06-11_add_safety_documents.sql --schema prisma/schema.prisma
-- ⚠️ 法令上の禁止（要件§7.4）: 健康保険の記号・番号、基礎年金番号、マイナンバーの列は追加してはならない。

-- CreateTable: 作業員安全プロフィール（Worker または User と1:1・排他）
CREATE TABLE "public"."WorkerSafetyProfile" (
    "id" TEXT NOT NULL,
    "workerId" TEXT,
    "userId" TEXT,
    "furigana" TEXT,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "jobType" TEXT,
    "attributes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hireDate" TIMESTAMP(3),
    "experienceYears" INTEGER,
    "workerCategory" TEXT,
    "address" TEXT,
    "tel" TEXT,
    "familyContact" TEXT,
    "familyTel" TEXT,
    "healthCheckDate" TIMESTAMP(3),
    "bloodPressure" TEXT,
    "bloodType" TEXT,
    "specialHealthCheckDate" TIMESTAMP(3),
    "specialHealthCheckType" TEXT,
    "healthInsurance" TEXT,
    "pensionInsurance" TEXT,
    "employmentInsurance" TEXT,
    "employmentInsuranceLast4" TEXT,
    "rosaiSpecialInsurance" BOOLEAN,
    "kentaikyo" BOOLEAN,
    "chutaikyo" BOOLEAN,
    "kentaikyoTechou" BOOLEAN,
    "ccusId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSafetyProfile_pkey" PRIMARY KEY ("id")
);

-- 排他制約: workerId / userId は必ずどちらか一方のみ（両方NULL・両方設定を禁止）。
-- @unique 2本だけでは両方NULLの行が複数作れる（PostgreSQL の NULL は unique 非衝突）ため必須。
ALTER TABLE "public"."WorkerSafetyProfile"
    ADD CONSTRAINT "WorkerSafetyProfile_target_xor"
    CHECK (num_nonnulls("workerId", "userId") = 1);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerSafetyProfile_workerId_key" ON "public"."WorkerSafetyProfile"("workerId");
CREATE UNIQUE INDEX "WorkerSafetyProfile_userId_key" ON "public"."WorkerSafetyProfile"("userId");

-- AddForeignKey
ALTER TABLE "public"."WorkerSafetyProfile" ADD CONSTRAINT "WorkerSafetyProfile_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "public"."Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."WorkerSafetyProfile" ADD CONSTRAINT "WorkerSafetyProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: 資格・教育（プロフィールと1:N）
CREATE TABLE "public"."WorkerQualification" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerQualification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerQualification_profileId_idx" ON "public"."WorkerQualification"("profileId");

-- AddForeignKey
ALTER TABLE "public"."WorkerQualification" ADD CONSTRAINT "WorkerQualification_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "public"."WorkerSafetyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: 安全書類本体（スナップショットJSON・論理削除）
CREATE TABLE "public"."SafetyDocument" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SafetyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyDocument_projectId_idx" ON "public"."SafetyDocument"("projectId");
CREATE INDEX "SafetyDocument_type_idx" ON "public"."SafetyDocument"("type");
CREATE INDEX "SafetyDocument_createdAt_idx" ON "public"."SafetyDocument"("createdAt");
CREATE INDEX "SafetyDocument_deletedAt_idx" ON "public"."SafetyDocument"("deletedAt");

-- AddForeignKey
ALTER TABLE "public"."SafetyDocument" ADD CONSTRAINT "SafetyDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."ProjectMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
