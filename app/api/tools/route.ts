import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, errorResponse, validateStringField } from '@/lib/api/utils';
import { resolveProjectNames, resolveUserNames } from '@/lib/tools/names';

// 工具の個体一覧（持出しリスト本体）。
// 閲覧は全ロール（協力会社も含む。どの工具が今どこにあるかを共有するのが目的のため）。
export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const tools = await prisma.tool.findMany({
            where: { isActive: true },
            orderBy: [
                { category: { sortOrder: 'asc' } },
                { sortOrder: 'asc' },
                { name: 'asc' },
            ],
            include: { category: { select: { name: true } } },
        });

        const [projectNames, userNames] = await Promise.all([
            resolveProjectNames(tools.map((t) => t.projectMasterId)),
            resolveUserNames(tools.map((t) => t.holderId)),
        ]);

        return NextResponse.json(
            tools.map(({ category, ...tool }) => ({
                ...tool,
                categoryName: category.name,
                projectName: tool.projectMasterId ? projectNames.get(tool.projectMasterId) ?? null : null,
                holderName: tool.holderId ? userNames.get(tool.holderId) ?? null : null,
            })),
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('工具一覧取得', error);
    }
}

// 工具の登録は管理者・マネージャーのみ（持出し/返却は社員全員 = [id]/checkout）
export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { categoryId, name, note } = await request.json();

        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;
        if (!categoryId || typeof categoryId !== 'string') {
            return errorResponse('工具の種類を指定してください', 400);
        }

        const category = await prisma.toolCategory.findUnique({ where: { id: categoryId } });
        if (!category || !category.isActive) {
            return errorResponse('工具の種類が見つかりません', 404);
        }

        const maxSortOrder = await prisma.tool.aggregate({
            _max: { sortOrder: true },
            where: { categoryId },
        });
        const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

        const tool = await prisma.tool.create({
            data: {
                categoryId,
                name: validatedName,
                note: typeof note === 'string' && note.trim() ? note.trim() : null,
                sortOrder: nextSortOrder,
            },
        });

        return NextResponse.json({ ...tool, categoryName: category.name, projectName: null, holderName: null }, { status: 201 });
    } catch (error) {
        return serverErrorResponse('工具登録', error);
    }
}
