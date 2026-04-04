import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';

/**
 * GET /api/my-schedule - マイスケジュール用の案件別工程データ取得
 *
 * Query params:
 *   startDate: YYYY-MM-DD
 *   endDate: YYYY-MM-DD
 *
 * Returns: 案件ごとに集計された工事種別・日付・職長情報
 */
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!['admin', 'manager'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        if (!startDate || !endDate) {
            return errorResponse('startDate と endDate は必須です', 400);
        }

        // 指定期間のassignmentsを取得（projectMaster含む）
        const assignments = await prisma.projectAssignment.findMany({
            where: {
                date: {
                    gte: new Date(startDate),
                    lte: new Date(endDate),
                },
            },
            include: {
                projectMaster: {
                    select: {
                        id: true,
                        title: true,
                        name: true,
                        customerName: true,
                        scheduledStartDate: true,
                        scheduledEndDate: true,
                        managerIds: true,
                        status: true,
                    },
                },
            },
            orderBy: { date: 'asc' },
        });

        // 職長リストを取得
        const foremen = await prisma.user.findMany({
            where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
            select: { id: true, displayName: true },
        });
        const foremenMap = new Map(foremen.map(f => [f.id, f.displayName]));

        // 工事種別マスターを取得
        const constructionTypes = await prisma.constructionType.findMany({
            where: { isActive: true },
            select: { id: true, name: true, color: true, sortOrder: true },
            orderBy: { sortOrder: 'asc' },
        });

        // 案件ごとに集計
        const projectMap = new Map<string, {
            projectMasterId: string;
            projectTitle: string;
            projectName: string | null;
            customerName: string | null;
            scheduledStartDate: string | null;
            scheduledEndDate: string | null;
            managerIds: string[];
            status: string;
            foremen: Map<string, string>;
            workEntries: { date: string; constructionTypeId: string | null }[];
        }>();

        for (const a of assignments) {
            const pmId = a.projectMasterId;
            if (!projectMap.has(pmId)) {
                projectMap.set(pmId, {
                    projectMasterId: pmId,
                    projectTitle: a.projectMaster.title,
                    projectName: a.projectMaster.name,
                    customerName: a.projectMaster.customerName,
                    scheduledStartDate: a.projectMaster.scheduledStartDate?.toISOString().split('T')[0] ?? null,
                    scheduledEndDate: a.projectMaster.scheduledEndDate?.toISOString().split('T')[0] ?? null,
                    managerIds: a.projectMaster.managerIds ?? [],
                    status: a.projectMaster.status,
                    foremen: new Map(),
                    workEntries: [],
                });
            }

            const project = projectMap.get(pmId)!;

            // 職長を追加
            if (a.assignedEmployeeId) {
                const name = foremenMap.get(a.assignedEmployeeId);
                if (name) {
                    project.foremen.set(a.assignedEmployeeId, name);
                }
            }

            // 作業日+工事種別を記録
            const dateStr = a.date instanceof Date
                ? a.date.toISOString().split('T')[0]
                : new Date(a.date).toISOString().split('T')[0];
            project.workEntries.push({
                date: dateStr,
                constructionTypeId: a.constructionType,
            });
        }

        // レスポンス形式に変換
        const result = Array.from(projectMap.values()).map(p => {
            const dates = p.workEntries.map(e => e.date).sort();
            const startDateActual = dates[0] ?? null;
            const endDateActual = dates[dates.length - 1] ?? null;

            return {
                projectMasterId: p.projectMasterId,
                projectTitle: p.projectTitle,
                projectName: p.projectName,
                customerName: p.customerName,
                // scheduledStartDate/EndDateが設定されていればそちらを優先
                startDate: p.scheduledStartDate ?? startDateActual,
                endDate: p.scheduledEndDate ?? endDateActual,
                actualStartDate: startDateActual,
                actualEndDate: endDateActual,
                managerIds: p.managerIds,
                status: p.status,
                foremen: Array.from(p.foremen.entries()).map(([id, displayName]) => ({
                    id,
                    displayName,
                })),
                workEntries: p.workEntries,
            };
        });

        return NextResponse.json({
            projects: result,
            constructionTypes,
        }, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('マイスケジュール取得', error);
    }
}
