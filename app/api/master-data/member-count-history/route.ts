import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const history = await prisma.memberCountHistory.findMany({
            orderBy: { startDate: 'asc' },
        });
        return NextResponse.json(history, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('メンバー数履歴取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { startDate, count } = await request.json();
        if (!startDate || typeof count !== 'number' || count < 1) {
            return validationErrorResponse('startDate と count(1以上) が必要です');
        }

        const entry = await prisma.memberCountHistory.create({
            data: { startDate: new Date(startDate), count },
        });
        return NextResponse.json(entry, { status: 201 });
    } catch (error) {
        return serverErrorResponse('メンバー数履歴追加', error);
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id, startDate, count } = await request.json();
        if (!id || !startDate || typeof count !== 'number' || count < 1) {
            return validationErrorResponse('id, startDate, count(1以上) が必要です');
        }

        const entry = await prisma.memberCountHistory.update({
            where: { id },
            data: { startDate: new Date(startDate), count },
        });
        return NextResponse.json(entry);
    } catch (error) {
        return serverErrorResponse('メンバー数履歴更新', error);
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await request.json();
        if (!id) {
            return validationErrorResponse('id が必要です');
        }

        // Prevent deleting the last entry
        const count = await prisma.memberCountHistory.count();
        if (count <= 1) {
            return validationErrorResponse('最低1件のメンバー数設定が必要です');
        }

        await prisma.memberCountHistory.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('メンバー数履歴削除', error);
    }
}
