import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validateStringField } from '@/lib/api/utils';

// 工具の種類マスタ一覧。
// 閲覧は全ロール（持出しリストの絞り込み・工具登録時のセレクタに使うため）。
export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const categories = await prisma.toolCategory.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            include: {
                // 種類を削除してよいか（工具が残っていないか）を設定画面で示すため
                _count: { select: { tools: { where: { isActive: true } } } },
            },
        });

        return NextResponse.json(
            categories.map(({ _count, ...category }) => ({ ...category, toolCount: _count.tools })),
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('工具の種類一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { name } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const maxSortOrder = await prisma.toolCategory.aggregate({
            _max: { sortOrder: true },
        });
        const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

        const category = await prisma.toolCategory.create({
            data: {
                name: validatedName,
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json({ ...category, toolCount: 0 }, { status: 201 });
    } catch (error) {
        return serverErrorResponse('工具の種類作成', error);
    }
}
