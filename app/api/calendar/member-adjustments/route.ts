import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const adjustments = await prisma.memberAdjustment.findMany();
        const adjustmentsMap = adjustments.reduce((acc, a) => {
            acc[a.dateKey] = a.adjustment;
            return acc;
        }, {} as Record<string, number>);

        return NextResponse.json(adjustmentsMap, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('メンバー調整値の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { dateKey, adjustment } = await req.json();

        if (!dateKey || typeof adjustment !== 'number') {
            return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
        }

        if (adjustment === 0) {
            await prisma.memberAdjustment.deleteMany({ where: { dateKey } });
            return NextResponse.json({ success: true, deleted: true });
        }

        await prisma.memberAdjustment.upsert({
            where: { dateKey },
            update: { adjustment },
            create: { dateKey, adjustment },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('メンバー調整値の更新', error);
    }
}
