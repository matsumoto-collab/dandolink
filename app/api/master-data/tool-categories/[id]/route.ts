import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, validateStringField } from '@/lib/api/utils';
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

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) {
            const validatedName = validateStringField(name, '名前', 100);
            if (validatedName instanceof NextResponse) return validatedName;
            updateData.name = validatedName;
        }
        if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder);

        const category = await prisma.toolCategory.update({
            where: { id },
            data: updateData,
        });
        return NextResponse.json(category);
    } catch (error) {
        return serverErrorResponse('工具の種類更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;

        // 工具が残ったまま種類を消すと持出しリストで種類名を失うため、先に工具を移すか消してもらう
        const remaining = await prisma.tool.count({ where: { categoryId: id, isActive: true } });
        if (remaining > 0) {
            // errorResponse は 409 を扱わないのでここだけ直接返す
            return NextResponse.json(
                { error: `この種類には工具が${remaining}台登録されています。先に工具を削除してください` },
                { status: 409, headers: { 'Cache-Control': 'no-store' } }
            );
        }

        await prisma.toolCategory.update({
            where: { id },
            data: { isActive: false },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('工具の種類削除', error);
    }
}
