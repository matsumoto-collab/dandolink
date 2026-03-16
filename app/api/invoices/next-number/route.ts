import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const year = new Date().getFullYear();
        const prefix = `I${year}`;

        // 今年度の連番請求書のうち最大番号を取得
        const latest = await prisma.invoice.findFirst({
            where: { invoiceNumber: { startsWith: prefix } },
            orderBy: { invoiceNumber: 'desc' },
            select: { invoiceNumber: true },
        });

        let nextSeq = 1;
        if (latest) {
            const seq = parseInt(latest.invoiceNumber.replace(prefix, ''), 10);
            if (!isNaN(seq)) nextSeq = seq + 1;
        }

        const nextNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

        return NextResponse.json({ nextNumber }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('次の請求番号の取得', error);
    }
}
