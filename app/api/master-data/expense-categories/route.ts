import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { expenseCategorySchema, validateRequest } from '@/lib/validations';

// 仕入請求書の費目マスタ一覧
export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const categories = await prisma.expenseCategory.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });

        return NextResponse.json(categories, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('費目マスタ一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(expenseCategorySchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { name, costBucket, sortOrder } = validation.data;

        const maxSortOrder = await prisma.expenseCategory.aggregate({
            _max: { sortOrder: true },
        });
        const nextSortOrder = sortOrder ?? (maxSortOrder._max.sortOrder ?? -1) + 1;

        const category = await prisma.expenseCategory.create({
            data: {
                name,
                costBucket: costBucket ?? 'other',
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(category, { status: 201 });
    } catch (error) {
        return serverErrorResponse('費目マスタ作成', error);
    }
}
