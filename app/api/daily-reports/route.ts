import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

const workItemSelect = {
    id: true, dailyReportId: true, assignmentId: true, startTime: true, endTime: true,
    assignment: { select: { id: true, date: true, projectMaster: { select: { id: true, title: true, customerName: true } } } },
};

const reportSelect = {
    id: true, foremanId: true, date: true,
    morningLoadingMinutes: true, eveningLoadingMinutes: true,
    earlyStartMinutes: true, overtimeMinutes: true, notes: true, createdAt: true, updatedAt: true,
    workItems: { select: workItemSelect },
};

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const foremanId = searchParams.get('foremanId');
        const date = searchParams.get('date');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        const where: Record<string, unknown> = {};
        if (foremanId) where.foremanId = foremanId;

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
        return NextResponse.json(dailyReports);
    } catch (error) {
        return serverErrorResponse('日報一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { foremanId, date, morningLoadingMinutes, eveningLoadingMinutes, earlyStartMinutes, overtimeMinutes, notes, workItems } = await request.json();
        if (!foremanId || !date) return validationErrorResponse('職長IDと日付は必須です');

        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

        const reportData = {
            morningLoadingMinutes: morningLoadingMinutes ?? 0, eveningLoadingMinutes: eveningLoadingMinutes ?? 0,
            earlyStartMinutes: earlyStartMinutes ?? 0, overtimeMinutes: overtimeMinutes ?? 0, notes,
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
                    data: workItems.map((item: { assignmentId: string; startTime?: string; endTime?: string }) => ({
                        dailyReportId: dailyReport.id, assignmentId: item.assignmentId,
                        startTime: item.startTime || null, endTime: item.endTime || null,
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
