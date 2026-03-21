import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validateStringField } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const titles = await prisma.billingTitle.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });

        return NextResponse.json(titles, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('請求項目一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { name, quantity, unit } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const maxSortOrder = await prisma.billingTitle.aggregate({
            _max: { sortOrder: true },
        });
        const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

        const title = await prisma.billingTitle.create({
            data: {
                name: validatedName,
                quantity: quantity ?? null,
                unit: unit || null,
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(title, { status: 201 });
    } catch (error) {
        return serverErrorResponse('請求項目作成', error);
    }
}
