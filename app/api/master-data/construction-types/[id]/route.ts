import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse, errorResponse, validateHexColor } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json();
        const { name, color, sortOrder } = body;

        const updateData: { name?: string; color?: string; sortOrder?: number } = {};

        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) {
                return validationErrorResponse('名前は必須です');
            }
            if (name.trim().length > 100) {
                return validationErrorResponse('名前は100文字以内で入力してください');
            }
            updateData.name = name.trim();
        }

        if (color !== undefined) {
            updateData.color = validateHexColor(color);
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
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

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
