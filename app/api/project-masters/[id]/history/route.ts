import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const assignments = await prisma.projectAssignment.findMany({
            where: { projectMasterId: id },
            orderBy: { date: 'desc' },
            include: { projectMaster: { select: { constructionType: true, constructionContent: true } } },
        });

        const employeeIds = new Set<string>();
        const vehicleIds = new Set<string>();

        assignments.forEach(a => {
            if (a.assignedEmployeeId) employeeIds.add(a.assignedEmployeeId);
            const workers = a.confirmedWorkerIds ? parseJsonField<string[]>(a.confirmedWorkerIds, []) : parseJsonField<string[]>(a.workers, []);
            workers.forEach(wid => employeeIds.add(wid));
            const vehicles = a.confirmedVehicleIds ? parseJsonField<string[]>(a.confirmedVehicleIds, []) : parseJsonField<string[]>(a.vehicles, []);
            vehicles.forEach(vid => vehicleIds.add(vid));
        });

        const [users, vehicleRecords] = await Promise.all([
            prisma.user.findMany({ where: { id: { in: Array.from(employeeIds) } }, select: { id: true, displayName: true } }),
            prisma.vehicle.findMany({ where: { id: { in: Array.from(vehicleIds) } }, select: { id: true, name: true } }),
        ]);

        const userMap = new Map(users.map(u => [u.id, u.displayName || u.id]));
        const vehicleMap = new Map(vehicleRecords.map(v => [v.id, v.name]));

        const history = assignments.map(a => {
            const workerIds = a.confirmedWorkerIds ? parseJsonField<string[]>(a.confirmedWorkerIds, []) : parseJsonField<string[]>(a.workers, []);
            const vehicleIdList = a.confirmedVehicleIds ? parseJsonField<string[]>(a.confirmedVehicleIds, []) : parseJsonField<string[]>(a.vehicles, []);
            return {
                id: a.id, date: a.date.toISOString(), foremanId: a.assignedEmployeeId,
                foremanName: userMap.get(a.assignedEmployeeId) || '不明',
                constructionType: a.projectMaster.constructionType, constructionContent: a.projectMaster.constructionContent,
                workerIds, workerNames: workerIds.map(wid => userMap.get(wid) || wid).filter(name => name !== userMap.get(a.assignedEmployeeId)),
                vehicleIds: vehicleIdList, vehicleNames: vehicleIdList.map(vid => vehicleMap.get(vid) || vid),
                isConfirmed: a.isDispatchConfirmed, remarks: a.remarks, createdAt: a.createdAt.toISOString(),
            };
        });

        return NextResponse.json(history);
    } catch (error) {
        return serverErrorResponse('作業履歴の取得', error);
    }
}
