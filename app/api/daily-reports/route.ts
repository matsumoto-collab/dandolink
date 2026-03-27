import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { createDailyReportApiSchema, validateRequest } from '@/lib/validations';

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

        // ロールベースフィルタリング: foreman2, worker, partner は自分の日報のみ
        const role = session!.user.role;
        if (role === 'foreman2' || role === 'worker' || role === 'partner') {
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
