import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validateStringField } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const items = await prisma.materialItem.findMany({
            where: { isActive: true },
            orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
            include: { category: true },
        });

        return NextResponse.json(items, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('材料品目一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { categoryId, name, spec, unit } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        if (!categoryId) {
            return NextResponse.json({ error: 'カテゴリIDは必須です' }, { status: 400 });
        }

        const maxSortOrder = await prisma.materialItem.aggregate({
            where: { categoryId },
            _max: { sortOrder: true },
        });
        const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

        const item = await prisma.materialItem.create({
            data: {
                categoryId,
                name: validatedName,
                spec: spec || null,
                unit: unit || '本',
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(item, { status: 201 });
    } catch (error) {
        return serverErrorResponse('材料品目作成', error);
    }
}
