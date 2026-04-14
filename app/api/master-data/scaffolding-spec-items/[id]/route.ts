import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse, errorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }
const VALID_TYPES = ['toggle', 'segment', 'text'] as const;

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json();
        const { name, type, options, sortOrder, groupId, hasText } = body;

        const updateData: Prisma.ScaffoldingSpecItemUpdateInput = {};

        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) return validationErrorResponse('名前は必須です');
            if (name.trim().length > 100) return validationErrorResponse('名前は100文字以内で入力してください');
            updateData.name = name.trim();
        }
        if (type !== undefined) {
            if (!VALID_TYPES.includes(type)) return validationErrorResponse('typeが不正です');
            updateData.type = type;
            if (type === 'segment') {
                if (!Array.isArray(options) || options.length === 0) return validationErrorResponse('segmentタイプは選択肢が必要です');
                updateData.options = options as Prisma.InputJsonValue;
            } else {
                updateData.options = Prisma.JsonNull;
            }
            if (type === 'text') updateData.hasText = false;
        } else if (options !== undefined) {
            updateData.options = options === null ? Prisma.JsonNull : (options as Prisma.InputJsonValue);
        }
        if (hasText !== undefined) {
            if (typeof hasText !== 'boolean') return validationErrorResponse('hasTextはboolean値で指定してください');
            const effectiveType = type ?? undefined;
            if (effectiveType !== 'text') updateData.hasText = hasText;
        }
        if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
        if (groupId !== undefined) updateData.group = { connect: { id: groupId } };

        const item = await prisma.scaffoldingSpecItem.update({ where: { id }, data: updateData });
        return NextResponse.json(item);
    } catch (error) {
        return serverErrorResponse('足場仕様項目更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        await prisma.scaffoldingSpecItem.update({ where: { id }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('足場仕様項目削除', error);
    }
}
