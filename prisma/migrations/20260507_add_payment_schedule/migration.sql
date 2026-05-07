-- CreateTable: 振込先マスター
CREATE TABLE "public"."Payee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKana" TEXT,
    "alias" TEXT,
    "feeBearer" TEXT NOT NULL DEFAULT 'them',
    "bankName" TEXT,
    "branchName" TEXT,
    "accountType" TEXT,
    "accountNumber" TEXT,
    "accountHolder" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 支払予定
CREATE TABLE "public"."PaymentSchedule" (
    "id" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentType" TEXT NOT NULL DEFAULT 'transfer',
    "payeeId" TEXT,
    "payeeName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "feeFlag" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3),
    "bankName" TEXT,
    "branchName" TEXT,
    "accountType" TEXT,
    "accountNumber" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Payee
CREATE INDEX "Payee_name_idx" ON "public"."Payee"("name");
CREATE INDEX "Payee_isActive_idx" ON "public"."Payee"("isActive");

-- CreateIndex: PaymentSchedule
CREATE INDEX "PaymentSchedule_paymentDate_idx" ON "public"."PaymentSchedule"("paymentDate");
CREATE INDEX "PaymentSchedule_payeeId_idx" ON "public"."PaymentSchedule"("payeeId");
CREATE INDEX "PaymentSchedule_paymentType_idx" ON "public"."PaymentSchedule"("paymentType");
CREATE INDEX "PaymentSchedule_isPaid_idx" ON "public"."PaymentSchedule"("isPaid");
CREATE INDEX "PaymentSchedule_paymentDate_paymentType_idx" ON "public"."PaymentSchedule"("paymentDate", "paymentType");

-- AddForeignKey
ALTER TABLE "public"."PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "public"."Payee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
