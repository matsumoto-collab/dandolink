import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validateStringField } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const contents = await prisma.constructionContent.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });

        return NextResponse.json(contents, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('工事内容一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { name } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const maxSortOrder = await prisma.constructionContent.aggregate({
            _max: { sortOrder: true },
        });
        const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

        const content = await prisma.constructionContent.create({
            data: {
                name: validatedName,
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(content, { status: 201 });
    } catch (error) {
        return serverErrorResponse('工事内容作成', error);
    }
}
