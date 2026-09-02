import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, errorResponse, notFoundResponse, validateStringField } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

interface RouteContext { params: Promise<{ id: string }>; }

/** 名前・分類の変更（台帳の詳細＝メーカーや型番は /api/equipment/tools/[id] が担当）。 */
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.tool.findUnique({ where: { id }, select: { id: true } });
        if (!current) return notFoundResponse('電動工具');

        const body = await request.json();
        const data: { name?: string; categoryId?: string } = {};

        if (body.name !== undefined) {
            const validatedName = validateStringField(body.name, '名前', 100);
            if (validatedName instanceof NextResponse) return validatedName;
            data.name = validatedName;
        }
        if (body.categoryId !== undefined) {
            const categoryId = String(body.categoryId || '').trim();
            if (!categoryId) return errorResponse('分類を選んでください', 400);
            const category = await prisma.toolCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
            if (!category) return errorResponse('分類が見つかりません', 400);
            data.categoryId = categoryId;
        }

        const tool = await prisma.tool.update({
            where: { id },
            data,
            include: { category: { select: { id: true, name: true, sortOrder: true } } },
        });

        return NextResponse.json({
            id: tool.id,
            name: tool.name,
            categoryId: tool.categoryId,
            categoryName: tool.category.name,
            categorySortOrder: tool.category.sortOrder,
            status: tool.status,
            sortOrder: tool.sortOrder,
            isActive: tool.isActive,
        });
    } catch (error) {
        return serverErrorResponse('電動工具の更新', error);
    }
}

/**
 * 一覧から外す。持出しや整備の履歴・過去の配置を残すため物理削除はせず isActive=false にする
 * （機材台帳の「使わなくなった工具も表示」で見える）。
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.tool.findUnique({ where: { id }, select: { id: true } });
        if (!current) return notFoundResponse('電動工具');

        await prisma.tool.update({ where: { id }, data: { isActive: false } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('電動工具の削除', error);
    }
}
