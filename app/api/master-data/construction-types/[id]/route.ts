import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const body = await request.json();
        const { name, color, sortOrder } = body;

        const updateData: { name?: string; color?: string; sortOrder?: number } = {};

        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) {
                return validationErrorResponse('名前は必須です');
            }
            updateData.name = name.trim();
        }

        if (color !== undefined) {
            updateData.color = color;
        }

        if (sortOrder !== undefined) {
            updateData.sortOrder = sortOrder;
        }

        const constructionType = await prisma.constructionType.update({
            where: { id },
            data: updateData,
        });
        return NextResponse.json(constructionType);
    } catch (error) {
        return serverErrorResponse('工事種別更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        await prisma.constructionType.update({
            where: { id },
            data: { isActive: false },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('工事種別削除', error);
    }
}
