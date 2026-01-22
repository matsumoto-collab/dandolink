import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface RouteContext {
    params: Promise<{ id: string }>;
}

// GET: 案件マスターに紐づく配置（作業履歴）を取得
export async function GET(
    _req: NextRequest,
    context: RouteContext
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = await context.params;

        // 案件マスターIDに紐づく配置を取得（ProjectMasterをincludeして工事種別も取得）
        const assignments = await prisma.projectAssignment.findMany({
            where: { projectMasterId: id },
            orderBy: { date: 'desc' },
            include: {
                projectMaster: {
                    select: {
                        constructionType: true,
                        constructionContent: true,
                    }
                }
            }
        });

        // 職長・職方・車両の名前を取得するため、追加のクエリ
        const employeeIds = new Set<string>();
        const vehicleIds = new Set<string>();

        assignments.forEach(a => {
            if (a.assignedEmployeeId) employeeIds.add(a.assignedEmployeeId);
            const workers = a.confirmedWorkerIds
                ? JSON.parse(a.confirmedWorkerIds)
                : (a.workers ? JSON.parse(a.workers) : []);
            workers.forEach((wid: string) => employeeIds.add(wid));

            const vehicles = a.confirmedVehicleIds
                ? JSON.parse(a.confirmedVehicleIds)
                : (a.vehicles ? JSON.parse(a.vehicles) : []);
            vehicles.forEach((vid: string) => vehicleIds.add(vid));
        });

        // ユーザー名取得
        const users = await prisma.user.findMany({
            where: { id: { in: Array.from(employeeIds) } },
            select: { id: true, displayName: true },
        });
        const userMap = new Map<string, string>();
        users.forEach(u => userMap.set(u.id, u.displayName || u.id));

        // 車両名取得
        const vehicleRecords = await prisma.vehicle.findMany({
            where: { id: { in: Array.from(vehicleIds) } },
            select: { id: true, name: true },
        });
        const vehicleMap = new Map<string, string>();
        vehicleRecords.forEach(v => vehicleMap.set(v.id, v.name));

        // レスポンス整形
        const history = assignments.map(a => {
            const workerIds = a.confirmedWorkerIds
                ? JSON.parse(a.confirmedWorkerIds)
                : (a.workers ? JSON.parse(a.workers) : []);
            const vehicleIdList = a.confirmedVehicleIds
                ? JSON.parse(a.confirmedVehicleIds)
                : (a.vehicles ? JSON.parse(a.vehicles) : []);

            return {
                id: a.id,
                date: a.date.toISOString(),
                foremanId: a.assignedEmployeeId,
                foremanName: userMap.get(a.assignedEmployeeId) || '不明',
                constructionType: a.projectMaster.constructionType,
                constructionContent: a.projectMaster.constructionContent,
                workerIds,
                workerNames: workerIds
                    .map((wid: string) => userMap.get(wid) || wid)
                    .filter((name: string) => name !== userMap.get(a.assignedEmployeeId)),
                vehicleIds: vehicleIdList,
                vehicleNames: vehicleIdList.map((vid: string) => vehicleMap.get(vid) || vid),
                isConfirmed: a.isDispatchConfirmed,
                remarks: a.remarks,
                createdAt: a.createdAt.toISOString(),
            };
        });

        return NextResponse.json(history);
    } catch (error) {
        console.error('Error in assignment history API:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
