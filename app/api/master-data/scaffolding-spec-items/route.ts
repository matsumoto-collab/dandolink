import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';

const VALID_TYPES = ['toggle', 'segment', 'text'] as const;

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;
        const items = await prisma.scaffoldingSpecItem.findMany({
            where: { isActive: true },
            orderBy: [{ groupId: 'asc' }, { sortOrder: 'asc' }],
        });
        return NextResponse.json(items, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('足場仕様項目一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const { groupId, name, type, options } = body;

        if (typeof groupId !== 'string' || !groupId) return validationErrorResponse('groupIdは必須です');
        if (typeof name !== 'string' || !name.trim()) return validationErrorResponse('名前は必須です');
        if (name.trim().length > 100) return validationErrorResponse('名前は100文字以内で入力してください');
        if (!VALID_TYPES.includes(type)) return validationErrorResponse('typeが不正です');
        if (type === 'segment' && (!Array.isArray(options) || options.length === 0)) {
            return validationErrorResponse('segmentタイプは選択肢が必要です');
        }

        const max = await prisma.scaffoldingSpecItem.aggregate({
            where: { groupId },
            _max: { sortOrder: true },
        });
        const nextSortOrder = (max._max.sortOrder ?? -1) + 1;

        const item = await prisma.scaffoldingSpecItem.create({
            data: {
                groupId,
                name: name.trim(),
                type,
                options: type === 'segment' ? options : null,
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(item, { status: 201 });
    } catch (error) {
        return serverErrorResponse('足場仕様項目作成', error);
    }
}
