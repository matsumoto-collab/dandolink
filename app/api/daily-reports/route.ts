import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse, errorResponse, notFoundResponse } from '@/lib/api/utils';
import { createDailyReportApiSchema, validateRequest } from '@/lib/validations';
import { isManagerOrAbove } from '@/utils/permissions';
import { parseJsonField } from '@/lib/json-utils';

const workItemSelect = {
    id: true, dailyReportId: true, assignmentId: true, startTime: true, endTime: true, breakMinutes: true, workerIds: true,
    assignment: { select: { id: true, date: true, projectMaster: { select: { id: true, title: true, name: true, honorific: true, customerName: true } } } },
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
        if (role === 'worker' || role === 'partner') {
            where.foremanId = session!.user.id;
            // 他人のforemanIdが指定された場合は拒否
            if (foremanId && foremanId !== session!.user.id) {
                return errorResponse('権限がありません', 403);
            }
        } else if (foremanId) {
            where.foremanId = foremanId;
        }

        if (date) {
            const targetDate = new Date(date);
            targetDate.setHours(0, 0, 0, 0);
            const nextDay = new Date(targetDate);
            nextDay.setDate(nextDay.getDate() + 1);
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

        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

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

            // 既存の日報が必須（職長以外は新規作成しない）
            const existingReport = await prisma.dailyReport.findUnique({
                where: { foremanId_date: { foremanId, date: targetDate } },
            });
            if (!existingReport) return notFoundResponse('日報');

            // 対象 assignment の confirmedWorkerIds を確認し、自分が含まれるものだけ許可
            const requestedAssignmentIds = items.map((i) => i.assignmentId);
            const assignmentsInRequest = await prisma.projectAssignment.findMany({
                where: { id: { in: requestedAssignmentIds } },
                select: { id: true, confirmedWorkerIds: true },
            });
            const allowedAssignmentIds = new Set(
                assignmentsInRequest
                    .filter((a) =>
                        parseJsonField<string[]>(a.confirmedWorkerIds, []).includes(session!.user.id)
                    )
                    .map((a) => a.id)
            );
            const allowedItems = items.filter((i) => allowedAssignmentIds.has(i.assignmentId));
            if (allowedItems.length === 0) {
                return errorResponse('編集権限のある作業項目がありません', 403);
            }

            // 許可された workItem だけ個別 upsert（deleteMany はしない＝他のWorkItemは保持）
            for (const item of allowedItems) {
                const existingItem = await prisma.dailyReportWorkItem.findFirst({
                    where: { dailyReportId: existingReport.id, assignmentId: item.assignmentId },
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
                            dailyReportId: existingReport.id,
                            assignmentId: item.assignmentId,
                            startTime: item.startTime || null,
                            endTime: item.endTime || null,
                            breakMinutes: item.breakMinutes ?? 0,
                            workerIds: item.workerIds ?? [],
                        },
                    });
                }
            }

            // updatedBy のみ更新
            await prisma.dailyReport.update({
                where: { id: existingReport.id },
                data: { updatedBy: session!.user.id },
            });

            const result = await prisma.dailyReport.findUnique({
                where: { id: existingReport.id },
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
