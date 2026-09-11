import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, serverErrorResponse } from '@/lib/api/utils';

/** 過去データの取り込み履歴（管理者のみ） */
export async function GET() {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const batches = await prisma.backfillImportBatch.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        // 今このバッチの印が付いている行の数（上書きで次のバッチに移った行は数えない）
        const withCounts = await Promise.all(
            batches.map(async (b) => {
                const [projects, invoices, assignments, adjustments] = await Promise.all([
                    prisma.projectMaster.count({ where: { importBatchId: b.id, isBackfilled: true } }),
                    prisma.invoice.count({ where: { importBatchId: b.id, isBackfilled: true } }),
                    prisma.projectAssignment.count({ where: { importBatchId: b.id, isBackfilled: true } }),
                    prisma.revenueAdjustment.count({ where: { importBatchId: b.id } }),
                ]);
                return { ...b, current: { projects, invoices, assignments, adjustments } };
            }),
        );
        return NextResponse.json(withCounts, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('過去データの取り込み履歴', error);
    }
}
