import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { costMasterSchema, validateRequest } from '@/lib/validations';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const costMasters = await prisma.costMaster.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });

        return NextResponse.json(costMasters, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('原価マスター一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(costMasterSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { name, quantity, unit, unitPrice } = validation.data;

        const maxSortOrder = await prisma.costMaster.aggregate({
            _max: { sortOrder: true },
        });
        const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

        const costMaster = await prisma.costMaster.create({
            data: {
                name,
                quantity: quantity ?? null,
                unit: unit ?? null,
                unitPrice: unitPrice ?? null,
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(costMaster, { status: 201 });
    } catch (error) {
        return serverErrorResponse('原価マスター作成', error);
    }
}
