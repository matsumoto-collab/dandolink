import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/daily-reports - 日報一覧を取得
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const foremanId = searchParams.get('foremanId');
        const date = searchParams.get('date');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        const where: Record<string, unknown> = {};

        if (foremanId) {
            where.foremanId = foremanId;
        }

        if (date) {
            // 特定の日付
            const targetDate = new Date(date);
            targetDate.setHours(0, 0, 0, 0);
            const nextDay = new Date(targetDate);
            nextDay.setDate(nextDay.getDate() + 1);
            where.date = {
                gte: targetDate,
                lt: nextDay,
            };
        } else if (startDate && endDate) {
            // 日付範囲
            where.date = {
                gte: new Date(startDate),
                lte: new Date(endDate),
            };
        }

        const dailyReports = await prisma.dailyReport.findMany({
            where,
            include: {
                workItems: {
                    include: {
                        assignment: {
                            include: {
                                projectMaster: true,
                            },
                        },
                    },
                },
            },
            orderBy: [
                { date: 'desc' },
                { foremanId: 'asc' },
            ],
        });

        return NextResponse.json(dailyReports);
    } catch (error) {
        console.error('Failed to fetch daily reports:', error);
        return NextResponse.json({ error: 'Failed to fetch daily reports' }, { status: 500 });
    }
}

// POST /api/daily-reports - 日報を作成/更新
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            foremanId,
            date,
            morningLoadingMinutes,
            eveningLoadingMinutes,
            earlyStartMinutes,
            overtimeMinutes,
            notes,
            workItems,
        } = body;

        if (!foremanId || !date) {
            return NextResponse.json({ error: 'foremanId and date are required' }, { status: 400 });
        }

        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

        // Upsert: 同一職長・同一日付の日報があれば更新、なければ作成
        const dailyReport = await prisma.dailyReport.upsert({
            where: {
                foremanId_date: {
                    foremanId,
                    date: targetDate,
                },
            },
            update: {
                morningLoadingMinutes: morningLoadingMinutes ?? 0,
                eveningLoadingMinutes: eveningLoadingMinutes ?? 0,
                earlyStartMinutes: earlyStartMinutes ?? 0,
                overtimeMinutes: overtimeMinutes ?? 0,
                notes,
            },
            create: {
                foremanId,
                date: targetDate,
                morningLoadingMinutes: morningLoadingMinutes ?? 0,
                eveningLoadingMinutes: eveningLoadingMinutes ?? 0,
                earlyStartMinutes: earlyStartMinutes ?? 0,
                overtimeMinutes: overtimeMinutes ?? 0,
                notes,
            },
        });

        // 作業明細を更新（既存を削除して再作成）
        if (workItems && Array.isArray(workItems)) {
            // 既存の作業明細を削除
            await prisma.dailyReportWorkItem.deleteMany({
                where: { dailyReportId: dailyReport.id },
            });

            // 新しい作業明細を作成
            if (workItems.length > 0) {
                await prisma.dailyReportWorkItem.createMany({
                    data: workItems.map((item: { assignmentId: string; workMinutes: number }) => ({
                        dailyReportId: dailyReport.id,
                        assignmentId: item.assignmentId,
                        workMinutes: item.workMinutes,
                    })),
                });
            }
        }

        // 作成/更新した日報を再取得
        const result = await prisma.dailyReport.findUnique({
            where: { id: dailyReport.id },
            include: {
                workItems: {
                    include: {
                        assignment: {
                            include: {
                                projectMaster: true,
                            },
                        },
                    },
                },
            },
        });

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        console.error('Failed to create/update daily report:', error);
        return NextResponse.json({ error: 'Failed to create/update daily report' }, { status: 500 });
    }
}
