import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const unitPriceMasterId = request.nextUrl.searchParams.get('unitPriceMasterId');

        const where: Record<string, unknown> = { isActive: true };
        if (unitPriceMasterId) {
            where.unitPriceMasterId = unitPriceMasterId;
        }

        const specifications = await prisma.unitPriceSpecification.findMany({
            where,
            orderBy: [{ unitPriceMasterId: 'asc' }, { sortOrder: 'asc' }],
        });
        return NextResponse.json(specifications, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('規格取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { unitPriceMasterId, name, sortOrder } = await request.json();
        if (!unitPriceMasterId || !name) {
            return validationErrorResponse('単価マスターIDと規格名は必須です');
        }

        const specification = await prisma.unitPriceSpecification.create({
            data: { unitPriceMasterId, name, sortOrder: sortOrder ?? 0 },
        });

        return NextResponse.json(specification, { status: 201 });
    } catch (error) {
        return serverErrorResponse('規格作成', error);
    }
}
