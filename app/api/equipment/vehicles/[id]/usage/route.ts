import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canViewEquipment } from '@/lib/equipment';

interface RouteContext { params: Promise<{ id: string }>; }

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * その車両を「いつ・どの案件で・誰が」使ったかの履歴。
 * 日々の配置に紐づく AssignmentVehicle からそのまま導出する（専用の入力は不要＝過去分も遡れる）。
 * 古い配置は vehicleId が入っていない場合があるため、車両名でも突き合わせる。
 */
export async function GET(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canViewEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const vehicle = await prisma.vehicle.findUnique({ where: { id } });
        if (!vehicle) return notFoundResponse('車両');

        const limitParam = Number(new URL(request.url).searchParams.get('limit'));
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

        const rows = await prisma.assignmentVehicle.findMany({
            where: { OR: [{ vehicleId: id }, { vehicleId: null, vehicleName: vehicle.name }] },
            include: {
                assignment: {
                    select: {
                        id: true,
                        date: true,
                        projectMasterId: true,
                        assignedEmployeeId: true,
                        assignmentWorkers: { select: { workerName: true } },
                    },
                },
            },
            orderBy: { assignment: { date: 'desc' } },
            take: limit,
        });

        // 案件名・職長名はライブ解決（当時の名前ではなく今の表示名を出す＝他画面と同じ方針）
        const pmIds = [...new Set(rows.map((r) => r.assignment.projectMasterId).filter(Boolean))];
        const userIds = [...new Set(rows.map((r) => r.assignment.assignedEmployeeId).filter(Boolean))];
        const [pms, users] = await Promise.all([
            pmIds.length
                ? prisma.projectMaster.findMany({ where: { id: { in: pmIds } }, select: { id: true, title: true, name: true } })
                : Promise.resolve([]),
            userIds.length
                ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })
                : Promise.resolve([]),
        ]);
        const pmMap = new Map(pms.map((p) => [p.id, p.name || p.title]));
        const userMap = new Map(users.map((u) => [u.id, u.displayName]));

        return NextResponse.json(
            rows.map((r) => ({
                id: r.id,
                date: r.assignment.date,
                projectMasterId: r.assignment.projectMasterId,
                projectName: pmMap.get(r.assignment.projectMasterId) ?? '(削除された案件)',
                foremanName: userMap.get(r.assignment.assignedEmployeeId) ?? '',
                workerNames: r.assignment.assignmentWorkers.map((w) => w.workerName).filter(Boolean),
            })),
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('車両の使用履歴の取得', error);
    }
}
