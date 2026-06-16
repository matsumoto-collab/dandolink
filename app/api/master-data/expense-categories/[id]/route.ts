import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }

const VALID_BUCKETS = ['material', 'other', 'loading'];

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json();
        const { name, costBucket, sortOrder } = body;

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = String(name).trim();
        if (costBucket !== undefined) {
            if (!VALID_BUCKETS.includes(costBucket)) return errorResponse('costBucket が不正です', 400);
            updateData.costBucket = costBucket;
        }
        if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);

        const category = await prisma.expenseCategory.update({
            where: { id },
            data: updateData,
        });
        return NextResponse.json(category);
    } catch (error) {
        return serverErrorResponse('費目マスタ更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        await prisma.expenseCategory.update({
            where: { id },
            data: { isActive: false },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('費目マスタ削除', error);
    }
}
