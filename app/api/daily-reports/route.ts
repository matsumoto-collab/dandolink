import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { createDailyReportApiSchema, validateRequest } from '@/lib/validations';
import { isManagerOrAbove } from '@/utils/permissions';
import { parseJsonField } from '@/lib/json-utils';
import { toJstDateOnly } from '@/lib/dateUtils';

const workItemSelect = {
    id: true, dailyReportId: true, assignmentId: true, startTime: true, endTime: true, breakMinutes: true, workerIds: true,
    assignment: {
        select: {
            id: true, date: true, sortOrder: true,
            workStartedAt: true, workEndedAt: true, workStartedComment: true, workEndedComment: true,
            projectMaster: { select: { id: true, title: true, name: true, honorific: true, customerName: true } },
            workReportReplies: {
                select: { id: true, reportType: true, authorId: true, body: true, createdAt: true },
                orderBy: { createdAt: 'asc' as const },
            },
        },
    },
};

const reportSelect = {
    id: true, foremanId: true, date: true,
    morningLoadingMinutes: true, eveningLoadingMinutes: true,
    earlyStartMinutes: true, overtimeMinutes: true, breakMinutes: true, notes: true, createdAt: true, updatedAt: true, updatedBy: true,
    workItems: { select: workItemSelect },
};

export async function GET(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const foremanId = searchParams.get('foremanId');
        const date = searchParams.get('date');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        const where: Record<string, unknown> = {};

        // ロールベースフィルタリング: worker, partner は自分の日報のみ
        // foreman2 は閲覧のみ全件可（編集・削除はDELETE/POSTで本人または管理者に制限）
        const role = session!.user.role;
        if (role === 'worker' || role === 'partner' || role === 'partner_member') {
            where.foremanId = session!.user.id;
            // 他人のforemanIdが指定された場合は拒否
            if (foremanId && foremanId !== session!.user.id) {
                return errorResponse('権限がありません', 403);
            }
        } else if (foremanId) {
            where.foremanId = foremanId;
        }

        if (date) {
            // JSTカレンダー日でフィルタ（サーバーローカルTZ非依存）
            const targetDate = toJstDateOnly(date);
            const nextDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
            where.date = { gte: targetDate, lt: nextDay };
        } else if (startDate && endDate) {
            where.date = { gte: new Date(startDate), lte: new Date(endDate) };
        }

        const dailyReports = await prisma.dailyReport.findMany({ where, select: reportSelect, orderBy: [{ date: 'desc' }, { foremanId: 'asc' }] });
        return NextResponse.json(dailyReports, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('日報一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(createDailyReportApiSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);

        const { foremanId, date, morningLoadingMinutes, eveningLoadingMinutes, earlyStartMinutes, overtimeMinutes, breakMinutes, notes, workItems } = validation.data;

        // JSTカレンダー日に正規化（書き込み・読み込みで foremanId_date キーを整合させる）
        const targetDate = toJstDateOnly(date);

        // フル編集権限: 担当職長本人 / admin / manager
        const isFullEditor =
            isManagerOrAbove(session!.user) || foremanId === session!.user.id;

        // 部分編集モード（2番手等の確定メンバー）:
        //   - 上位フィールド(notes, breakMinutes, loadingMinutes 等)は変更しない
        //   - workItems は「自分が確定メンバーの assignment」のみ upsert（他は触らない・削除しない）
        if (!isFullEditor) {
            const items = workItems ?? [];
            if (items.length === 0) {
                return errorResponse('編集権限のある作業項目がありません', 403);
            }

            // 対象 assignment を取得し、確認: confirmedWorkerIds に自分が含まれ、
            // かつ assignedEmployeeId === foremanId（指定された職長の手配）の案件のみ許可
            const requestedAssignmentIds = items.map((i) => i.assignmentId);
            const assignmentsInRequest = await prisma.projectAssignment.findMany({
                where: { id: { in: requestedAssignmentIds } },
                select: { id: true, assignedEmployeeId: true, confirmedWorkerIds: true },
            });
            const allowedAssignmentIds = new Set(
                assignmentsInRequest
                    .filter((a) =>
                        a.assignedEmployeeId === foremanId &&
                        parseJsonField<string[]>(a.confirmedWorkerIds, []).includes(session!.user.id)
                    )
                    .map((a) => a.id)
            );
            const allowedItems = items.filter((i) => allowedAssignmentIds.has(i.assignmentId));
            if (allowedItems.length === 0) {
                return errorResponse('編集権限のある作業項目がありません', 403);
            }

            // 既存日報が無ければ職長空きシェルを作成（上位フィールドはデフォルト値）
            const dailyReport = await prisma.dailyReport.upsert({
                where: { foremanId_date: { foremanId, date: targetDate } },
                update: { updatedBy: session!.user.id },
                create: { foremanId, date: targetDate, updatedBy: session!.user.id },
            });

            // 許可された workItem だけ個別 upsert（deleteMany はしない＝他のWorkItemは保持）
            for (const item of allowedItems) {
                const existingItem = await prisma.dailyReportWorkItem.findFirst({
                    where: { dailyReportId: dailyReport.id, assignmentId: item.assignmentId },
                });
                if (existingItem) {
                    await prisma.dailyReportWorkItem.update({
                        where: { id: existingItem.id },
                        data: {
                            startTime: item.startTime || null,
                            endTime: item.endTime || null,
                            breakMinutes: item.breakMinutes ?? 0,
                            workerIds: item.workerIds ?? [],
                        },
                    });
                } else {
                    await prisma.dailyReportWorkItem.create({
                        data: {
                            dailyReportId: dailyReport.id,
                            assignmentId: item.assignmentId,
                            startTime: item.startTime || null,
                            endTime: item.endTime || null,
                            breakMinutes: item.breakMinutes ?? 0,
                            workerIds: item.workerIds ?? [],
                        },
                    });
                }
            }

            const result = await prisma.dailyReport.findUnique({
                where: { id: dailyReport.id },
                select: reportSelect,
            });
            return NextResponse.json(result, { status: 200 });
        }

        // フル編集（従来どおり）
        const reportData = {
            morningLoadingMinutes: morningLoadingMinutes ?? 0, eveningLoadingMinutes: eveningLoadingMinutes ?? 0,
            earlyStartMinutes: earlyStartMinutes ?? 0, overtimeMinutes: overtimeMinutes ?? 0, breakMinutes: breakMinutes ?? 0, notes,
            updatedBy: session!.user.id,
        };

        const dailyReport = await prisma.dailyReport.upsert({
            where: { foremanId_date: { foremanId, date: targetDate } },
            update: reportData,
            create: { foremanId, date: targetDate, ...reportData },
        });

        if (workItems && Array.isArray(workItems)) {
            await prisma.dailyReportWorkItem.deleteMany({ where: { dailyReportId: dailyReport.id } });
            if (workItems.length > 0) {
                await prisma.dailyReportWorkItem.createMany({
                    data: workItems.map((item: { assignmentId: string; startTime?: string | null; endTime?: string | null; breakMinutes?: number; workerIds?: string[] }) => ({
                        dailyReportId: dailyReport.id, assignmentId: item.assignmentId,
                        startTime: item.startTime || null, endTime: item.endTime || null,
                        breakMinutes: item.breakMinutes ?? 0,
                        workerIds: item.workerIds ?? [],
                    })),
                });
            }
        }

        const result = await prisma.dailyReport.findUnique({ where: { id: dailyReport.id }, select: reportSelect });
        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        return serverErrorResponse('日報作成/更新', error);
    }
}
