import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, validateStringField } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }

// 工具そのものの編集（名前・種類の変更）。状態と持出し先の変更は [id]/checkout 側。
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await request.json();
        const { categoryId, name, note, sortOrder } = body;

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) {
            const validatedName = validateStringField(name, '名前', 100);
            if (validatedName instanceof NextResponse) return validatedName;
            updateData.name = validatedName;
        }
        if (categoryId !== undefined) {
            const category = await prisma.toolCategory.findUnique({ where: { id: String(categoryId) } });
            if (!category || !category.isActive) return errorResponse('工具の種類が見つかりません', 404);
            updateData.categoryId = categoryId;
        }
        if (note !== undefined) {
            updateData.note = typeof note === 'string' && note.trim() ? note.trim() : null;
        }
        if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);

        const tool = await prisma.tool.update({
            where: { id },
            data: updateData,
            include: { category: { select: { name: true } } },
        });

        const { category, ...rest } = tool;
        return NextResponse.json({ ...rest, categoryName: category.name });
    } catch (error) {
        return serverErrorResponse('工具更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        // 履歴（ToolCheckoutLog）を残すため論理削除
        await prisma.tool.update({
            where: { id },
            data: { isActive: false },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('工具削除', error);
    }
}
