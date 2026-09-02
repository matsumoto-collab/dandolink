import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, errorResponse, validateStringField } from '@/lib/api/utils';

/** 分類を指定せずに追加されたときの受け皿。機材台帳の分類と同じテーブル。 */
const DEFAULT_CATEGORY_NAME = '電動工具';

/**
 * 設定画面（マスター・設定 ＞ 電動工具）用の一覧。
 * 実体は機材台帳の Tool / ToolCategory そのもの＝ここで追加した工具はそのまま台帳に出る。
 */
export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const [categories, tools] = await Promise.all([
            prisma.toolCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
            // /api/master-data と同じく全件返す（画面側で isActive=false を隠す）。
            // 経路によってストアの中身が変わると、過去の配置の工具名が解決できなくなるため。
            prisma.tool.findMany({
                orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                include: { category: { select: { id: true, name: true, sortOrder: true } } },
            }),
        ]);

        return NextResponse.json({
            categories: categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder })),
            tools: tools.map((t) => ({
                id: t.id,
                name: t.name,
                categoryId: t.categoryId,
                categoryName: t.category.name,
                categorySortOrder: t.category.sortOrder,
                status: t.status,
                sortOrder: t.sortOrder,
                isActive: t.isActive,
            })),
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('電動工具一覧の取得', error);
    }
}

/** 電動工具を1台追加する。分類の指定が無ければ「電動工具」分類を用意してそこに入れる。 */
export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { name, categoryId } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        let resolvedCategoryId: string;
        if (typeof categoryId === 'string' && categoryId.trim() !== '') {
            const category = await prisma.toolCategory.findUnique({ where: { id: categoryId.trim() }, select: { id: true } });
            if (!category) return errorResponse('分類が見つかりません', 400);
            resolvedCategoryId = category.id;
        } else {
            const existing = await prisma.toolCategory.findFirst({
                where: { isActive: true },
                orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                select: { id: true },
            });
            resolvedCategoryId = existing
                ? existing.id
                : (await prisma.toolCategory.create({ data: { name: DEFAULT_CATEGORY_NAME, sortOrder: 0 }, select: { id: true } })).id;
        }

        const tool = await prisma.tool.create({
            data: { name: validatedName, categoryId: resolvedCategoryId },
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
        }, { status: 201 });
    } catch (error) {
        return serverErrorResponse('電動工具の追加', error);
    }
}
