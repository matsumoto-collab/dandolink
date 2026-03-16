import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const year = new Date().getFullYear();
        const prefix = `E${year}`;

        // 今年度の連番見積書のうち最大番号を取得
        const latest = await prisma.estimate.findFirst({
            where: { estimateNumber: { startsWith: prefix } },
            orderBy: { estimateNumber: 'desc' },
            select: { estimateNumber: true },
        });

        let nextSeq = 1;
        if (latest) {
            const seq = parseInt(latest.estimateNumber.replace(prefix, ''), 10);
            if (!isNaN(seq)) nextSeq = seq + 1;
        }

        // 旧形式(YYYY-NNNN)からの移行: 旧形式の最大番号もチェック
        if (nextSeq === 1) {
            const oldPrefix = `${year}-`;
            const oldLatest = await prisma.estimate.findFirst({
                where: { estimateNumber: { startsWith: oldPrefix } },
                orderBy: { estimateNumber: 'desc' },
                select: { estimateNumber: true },
            });
            if (oldLatest) {
                const oldSeq = parseInt(oldLatest.estimateNumber.replace(oldPrefix, ''), 10);
                if (!isNaN(oldSeq)) nextSeq = oldSeq + 1;
            }
        }

        const nextNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

        return NextResponse.json({ nextNumber }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('次の見積番号の取得', error);
    }
}
