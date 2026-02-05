import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

// デフォルトの工事種別データ
const DEFAULT_CONSTRUCTION_TYPES = [
    { name: '組立', color: '#a8c8e8', sortOrder: 0 },
    { name: '解体', color: '#f0a8a8', sortOrder: 1 },
    { name: 'その他', color: '#fef08a', sortOrder: 2 },
];

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        let constructionTypes = await prisma.constructionType.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });

        // データが空の場合はデフォルトデータをシード
        if (constructionTypes.length === 0) {
            await prisma.constructionType.createMany({
                data: DEFAULT_CONSTRUCTION_TYPES,
            });
            constructionTypes = await prisma.constructionType.findMany({
                where: { isActive: true },
                orderBy: { sortOrder: 'asc' },
            });
        }

        return NextResponse.json(constructionTypes);
    } catch (error) {
        return serverErrorResponse('工事種別一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { name, color } = await request.json();
        if (!name || typeof name !== 'string') {
            return validationErrorResponse('名前は必須です');
        }

        // 最大のsortOrderを取得して+1
        const maxSortOrder = await prisma.constructionType.aggregate({
            _max: { sortOrder: true },
        });
        const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

        const constructionType = await prisma.constructionType.create({
            data: {
                name: name.trim(),
                color: color || '#a8c8e8',
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(constructionType, { status: 201 });
    } catch (error) {
        return serverErrorResponse('工事種別作成', error);
    }
}
