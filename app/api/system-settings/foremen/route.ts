import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, parseJsonField, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { displayedForemanIdsSchema, validateRequest } from '@/lib/validations';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
        return NextResponse.json({
            displayedForemanIds: settings ? parseJsonField<string[]>(settings.displayedForemanIds, []) : [],
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('職長表示設定の取得', error);
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(displayedForemanIdsSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { displayedForemanIds } = validation.data;
        const settings = await prisma.systemSettings.upsert({
            where: { id: 'default' },
            update: { displayedForemanIds: JSON.stringify(displayedForemanIds || []) },
            create: { id: 'default', displayedForemanIds: JSON.stringify(displayedForemanIds || []) },
        });

        return NextResponse.json({
            displayedForemanIds: parseJsonField<string[]>(settings.displayedForemanIds, []),
        });
    } catch (error) {
        return serverErrorResponse('職長表示設定の更新', error);
    }
}
