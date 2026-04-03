import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json();
        const { name, quantity, unit, unitPrice, sortOrder } = body;

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name.trim();
        if (quantity !== undefined) updateData.quantity = quantity != null ? Number(quantity) : null;
        if (unit !== undefined) updateData.unit = unit?.trim() || null;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice != null ? Number(unitPrice) : null;
        if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

        const costMaster = await prisma.costMaster.update({
            where: { id },
            data: updateData,
        });
        return NextResponse.json(costMaster);
    } catch (error) {
        return serverErrorResponse('原価マスター更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        await prisma.costMaster.update({
            where: { id },
            data: { isActive: false },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('原価マスター削除', error);
    }
}
