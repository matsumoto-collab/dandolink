import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const { name, sortOrder } = await request.json();

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

        const updated = await prisma.unitPriceTemplate.update({ where: { id }, data: updateData });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('テンプレート更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        await prisma.unitPriceTemplate.update({ where: { id }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('テンプレート削除', error);
    }
}
