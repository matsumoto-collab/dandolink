import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json();
        const { name, sortOrder } = body;

        const updateData: { name?: string; sortOrder?: number } = {};

        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) {
                return validationErrorResponse('名前は必須です');
            }
            if (name.trim().length > 100) {
                return validationErrorResponse('名前は100文字以内で入力してください');
            }
            updateData.name = name.trim();
        }

        if (sortOrder !== undefined) {
            updateData.sortOrder = sortOrder;
        }

        const suffix = await prisma.constructionSuffix.update({
            where: { id },
            data: updateData,
        });
        return NextResponse.json(suffix);
    } catch (error) {
        return serverErrorResponse('工事名称更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        await prisma.constructionSuffix.update({
            where: { id },
            data: { isActive: false },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('工事名称削除', error);
    }
}
