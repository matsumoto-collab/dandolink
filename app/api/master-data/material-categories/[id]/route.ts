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
        if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

        const category = await prisma.materialCategory.update({
            where: { id },
            data,
        });
        return NextResponse.json(category);
    } catch (error) {
        return serverErrorResponse('材料カテゴリ更新', error);
    }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await params;
        await prisma.materialCategory.update({
            where: { id },
            data: { isActive: false },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('材料カテゴリ削除', error);
    }
}
