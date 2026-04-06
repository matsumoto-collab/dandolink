import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { unitPriceSpecificationSchema, validateRequest } from '@/lib/validations';

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

        const body = await request.json();
        const validation = validateRequest(unitPriceSpecificationSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { unitPriceMasterId, name, sortOrder } = validation.data;

        const specification = await prisma.unitPriceSpecification.create({
            data: { unitPriceMasterId, name, sortOrder: sortOrder ?? 0 },
        });

        return NextResponse.json(specification, { status: 201 });
    } catch (error) {
        return serverErrorResponse('規格作成', error);
    }
}
