import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const templates = await prisma.unitPriceTemplate.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });
        return NextResponse.json(templates, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('テンプレート取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { name, sortOrder } = await request.json();
        if (!name) {
            return validationErrorResponse('テンプレート名は必須です');
        }

        const template = await prisma.unitPriceTemplate.create({
            data: { name, sortOrder: sortOrder ?? 0 },
        });

        return NextResponse.json(template, { status: 201 });
    } catch (error) {
        return serverErrorResponse('テンプレート作成', error);
    }
}
