import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { memberCountHistoryCreateSchema, memberCountHistoryUpdateSchema, memberCountHistoryDeleteSchema, validateRequest } from '@/lib/validations';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const history = await prisma.memberCountHistory.findMany({
            orderBy: { startDate: 'asc' },
        });
        return NextResponse.json(history, {
            headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120, must-revalidate' },
        });
    } catch (error) {
        return serverErrorResponse('メンバー数履歴取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(memberCountHistoryCreateSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { startDate, count } = validation.data;

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

        const body = await request.json();
        const validation = validateRequest(memberCountHistoryUpdateSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { id, startDate, count } = validation.data;

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

        const body = await request.json();
        const validation = validateRequest(memberCountHistoryDeleteSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { id } = validation.data;

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
