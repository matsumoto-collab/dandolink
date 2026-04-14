import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { scaffoldingSpecItemSchema, validateRequest } from '@/lib/validations';

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
        const validation = validateRequest(scaffoldingSpecItemSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { groupId, name, type, options, hasText } = validation.data;

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
                name,
                type,
                options: type === 'segment' && options ? options : undefined,
                hasText: type !== 'text' ? !!hasText : false,
                sortOrder: nextSortOrder,
            },
        });
        return NextResponse.json(item, { status: 201 });
    } catch (error) {
        return serverErrorResponse('足場仕様項目作成', error);
    }
}
