import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { unitPriceCategorySchema, validateRequest } from '@/lib/validations';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const categories = await prisma.unitPriceCategory.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });
        return NextResponse.json(categories, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('カテゴリ取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(unitPriceCategorySchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { name, sortOrder, quantity, unit } = validation.data;

        const category = await prisma.unitPriceCategory.create({
            data: {
                name,
                sortOrder: sortOrder ?? 0,
                ...(quantity !== undefined && { quantity }),
                ...(unit !== undefined && { unit }),
            },
        });

        return NextResponse.json(category, { status: 201 });
    } catch (error) {
        return serverErrorResponse('カテゴリ作成', error);
    }
}
