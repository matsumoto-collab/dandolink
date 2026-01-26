import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

function formatUnitPrice(up: { templates: string; [key: string]: unknown }) {
    return { ...up, templates: parseJsonField<unknown[]>(up.templates, []) };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const { description, unit, unitPrice, templates, notes } = await request.json();

        const updateData: Record<string, unknown> = {};
        if (description !== undefined) updateData.description = description;
        if (unit !== undefined) updateData.unit = unit;
        if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
        if (templates !== undefined) updateData.templates = JSON.stringify(templates);
        if (notes !== undefined) updateData.notes = notes;

        const updated = await prisma.unitPriceMaster.update({ where: { id }, data: updateData });
        return NextResponse.json(formatUnitPrice(updated));
    } catch (error) {
        return serverErrorResponse('単価マスタ更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        await prisma.unitPriceMaster.update({ where: { id }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('単価マスタ削除', error);
    }
}
