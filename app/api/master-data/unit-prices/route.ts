import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

function formatUnitPrice(up: { templates: string; [key: string]: unknown }) {
    return { ...up, templates: parseJsonField<unknown[]>(up.templates, []) };
}

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const unitPrices = await prisma.unitPriceMaster.findMany({ where: { isActive: true }, orderBy: { description: 'asc' } });
        return NextResponse.json(unitPrices.map(formatUnitPrice));
    } catch (error) {
        return serverErrorResponse('単価マスタ取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { description, unit, unitPrice, templates, notes } = await request.json();
        if (!description || !unit || unitPrice === undefined || !templates) {
            return validationErrorResponse('説明、単位、単価、テンプレートは必須です');
        }

        const newUnitPrice = await prisma.unitPriceMaster.create({
            data: { description, unit, unitPrice, templates: JSON.stringify(templates), notes: notes || null },
        });

        return NextResponse.json(formatUnitPrice(newUnitPrice), { status: 201 });
    } catch (error) {
        return serverErrorResponse('単価マスタ作成', error);
    }
}
