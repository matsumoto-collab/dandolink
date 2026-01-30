
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting data migration...');

    // Fetch all assignments that might have legacy data
    // Only process those where we haven't migrated yet? 
    // For now, process 'workers' and 'vehicles' if they exist.
    // We can use upsert or check for existence to avoid duplicates if run multiple times.
    const assignments = await prisma.projectAssignment.findMany({
        where: {
            OR: [
                { workers: { not: null } },
                { vehicles: { not: null } },
            ],
        },
    });

    console.log(`Found ${assignments.length} assignments to process.`);

    let processedCount = 0;
    let errorCount = 0;

    for (const assignment of assignments) {
        try {
            // 1. Migrate Workers
            if (assignment.workers) {
                let workerIds: string[] = [];
                try {
                    // Attempt to parse JSON
                    const value = JSON.parse(assignment.workers);
                    if (Array.isArray(value)) {
                        workerIds = value;
                    } else if (typeof value === 'string') {
                        // Sometimes double encoded or just a string?
                        workerIds = [value];
                    }
                } catch (e) {
                    // If not JSON, maybe comma separated or single value? 
                    // Assuming existing logic `JSON.parse` implies it IS valid JSON string array.
                    // But if it fails, log it.
                    console.warn(`[Assignment ${assignment.id}] Failed to parse workers JSON: ${assignment.workers}`);
                }

                // Insert into AssignmentWorker
                for (const wId of workerIds) {
                    // Check if relation already exists
                    const existing = await prisma.assignmentWorker.findFirst({
                        where: {
                            assignmentId: assignment.id,
                            workerId: wId // Assuming wId is the unique identifier used
                        }
                    });

                    if (!existing) {
                        // We need `workerName`. 
                        // Ideally fetch from Worker master, but if not found?
                        // Or can we trust `wId` is the name if it's not a UUID?
                        // Since we don't have easy logic here without importing helpers,
                        // Let's try to fetch Worker.
                        const worker = await prisma.worker.findFirst({ where: { id: wId } });
                        const name = worker ? worker.name : (wId.length > 20 ? 'Unknown' : wId); // Fallback: use ID as name if short, else Unknown

                        await prisma.assignmentWorker.create({
                            data: {
                                assignmentId: assignment.id,
                                workerId: wId,
                                workerName: name,
                            }
                        });
                    }
                }
            }

            // 2. Migrate Vehicles
            if (assignment.vehicles) {
                let vehicleIds: string[] = [];
                try {
                    const value = JSON.parse(assignment.vehicles);
                    if (Array.isArray(value)) {
                        vehicleIds = value;
                    }
                } catch (e) {
                    console.warn(`[Assignment ${assignment.id}] Failed to parse vehicles JSON: ${assignment.vehicles}`);
                }

                for (const vId of vehicleIds) {
                    const existing = await prisma.assignmentVehicle.findFirst({
                        where: {
                            assignmentId: assignment.id,
                            vehicleId: vId
                        }
                    });

                    if (!existing) {
                        const vehicle = await prisma.vehicle.findFirst({ where: { id: vId } });
                        const name = vehicle ? vehicle.name : (vId.length > 20 ? 'Unknown' : vId);

                        await prisma.assignmentVehicle.create({
                            data: {
                                assignmentId: assignment.id,
                                vehicleId: vId,
                                vehicleName: name,
                            }
                        });
                    }
                }
            }
            processedCount++;
        } catch (e) {
            console.error(`[Assignment ${assignment.id}] Error migrating:`);
            console.error('Workers:', assignment.workers);
            console.error('Vehicles:', assignment.vehicles);
            console.error(e);
            errorCount++;
        }
    }

    console.log(`Migration finished. Processed: ${processedCount}, Errors: ${errorCount}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
