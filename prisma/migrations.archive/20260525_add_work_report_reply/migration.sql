-- CreateTable
CREATE TABLE "public"."WorkReportReply" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkReportReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkReportReply_assignmentId_reportType_idx" ON "public"."WorkReportReply"("assignmentId", "reportType");

-- CreateIndex
CREATE INDEX "WorkReportReply_authorId_idx" ON "public"."WorkReportReply"("authorId");

-- AddForeignKey
ALTER TABLE "public"."WorkReportReply" ADD CONSTRAINT "WorkReportReply_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
