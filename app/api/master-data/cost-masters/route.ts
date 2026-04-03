import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validateStringField } from '@/lib/api/utils';

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

        const { name, quantity, unit, unitPrice } = await request.json();
        const validatedName = validateStringField(name, '名前', 100);
        if (validatedName instanceof NextResponse) return validatedName;

        const maxSortOrder = await prisma.costMaster.aggregate({
            _max: { sortOrder: true },
        });
        const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

        const costMaster = await prisma.costMaster.create({
            data: {
                name: validatedName,
                quantity: quantity != null ? Number(quantity) : null,
                unit: unit?.trim() || null,
                unitPrice: unitPrice != null ? Number(unitPrice) : null,
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(costMaster, { status: 201 });
    } catch (error) {
        return serverErrorResponse('原価マスター作成', error);
    }
}
