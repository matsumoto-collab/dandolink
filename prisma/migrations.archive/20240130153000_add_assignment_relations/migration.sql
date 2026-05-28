-- CreateTable
CREATE TABLE "public"."AssignmentWorker" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "workerId" TEXT,
    "workerName" TEXT NOT NULL,

    CONSTRAINT "AssignmentWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AssignmentVehicle" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "vehicleName" TEXT NOT NULL,

    CONSTRAINT "AssignmentVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentWorker_assignmentId_idx" ON "public"."AssignmentWorker"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentWorker_workerName_idx" ON "public"."AssignmentWorker"("workerName");

-- CreateIndex
CREATE INDEX "AssignmentVehicle_assignmentId_idx" ON "public"."AssignmentVehicle"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentVehicle_vehicleName_idx" ON "public"."AssignmentVehicle"("vehicleName");

-- AddForeignKey
ALTER TABLE "public"."AssignmentWorker" ADD CONSTRAINT "AssignmentWorker_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssignmentVehicle" ADD CONSTRAINT "AssignmentVehicle_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "public"."ProjectAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

