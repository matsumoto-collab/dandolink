import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validateStringField } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const groups = await prisma.scaffoldingSpecGroup.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            include: {
                items: {
                    where: { isActive: true },
                    orderBy: { sortOrder: 'asc' },
                },
            },
        });

        return NextResponse.json(groups, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('足場仕様グループ一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { name } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const max = await prisma.scaffoldingSpecGroup.aggregate({ _max: { sortOrder: true } });
        const nextSortOrder = (max._max.sortOrder ?? -1) + 1;

        const group = await prisma.scaffoldingSpecGroup.create({
            data: { name: validatedName, sortOrder: nextSortOrder },
        });
        return NextResponse.json(group, { status: 201 });
    } catch (error) {
        return serverErrorResponse('足場仕様グループ作成', error);
    }
}
