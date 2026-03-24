import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse, validateStringField } from '@/lib/api/utils';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await params;
        const body = await request.json();
        const data: Record<string, unknown> = {};

        if (body.name !== undefined) {
            const validatedName = validateStringField(body.name, '名前', 100);
            if (validatedName instanceof NextResponse) return validatedName;
            data.name = validatedName;
        }
        if (body.spec !== undefined) data.spec = body.spec || null;
        if (body.unit !== undefined) data.unit = body.unit;
        if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
        if (body.categoryId !== undefined) data.categoryId = body.categoryId;

        const item = await prisma.materialItem.update({
            where: { id },
            data,
        });
        return NextResponse.json(item);
    } catch (error) {
        return serverErrorResponse('材料品目更新', error);
    }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await params;
        await prisma.materialItem.update({
            where: { id },
            data: { isActive: false },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('材料品目削除', error);
    }
}
