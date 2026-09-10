import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validateStringField } from '@/lib/api/utils';

/** 置き場所（土場 / 上野 …）の一覧。棚卸の対象単位 */
export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const locations = await prisma.storageLocation.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });

        return NextResponse.json(locations, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('置き場所一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { name } = await request.json();
        const validatedName = validateStringField(name, '名前', 50);
        if (validatedName instanceof NextResponse) return validatedName;

        const max = await prisma.storageLocation.aggregate({ _max: { sortOrder: true } });
        const location = await prisma.storageLocation.create({
            data: { name: validatedName, sortOrder: (max._max.sortOrder ?? -1) + 1 },
        });
        return NextResponse.json(location, { status: 201 });
    } catch (error) {
        return serverErrorResponse('置き場所作成', error);
    }
}
