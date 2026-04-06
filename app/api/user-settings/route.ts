import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { displayedForemanIdsSchema, validateRequest } from '@/lib/validations';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const settings = await prisma.userSettings.findUnique({ where: { userId: session!.user.id } });
        return NextResponse.json({ displayedForemanIds: settings ? parseJsonField<string[]>(settings.displayedForemanIds, []) : [] });
    } catch (error) {
        return serverErrorResponse('ユーザー設定の取得', error);
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(displayedForemanIdsSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { displayedForemanIds } = validation.data;
        const settings = await prisma.userSettings.upsert({
            where: { userId: session!.user.id },
            update: { displayedForemanIds: JSON.stringify(displayedForemanIds || []) },
            create: { userId: session!.user.id, displayedForemanIds: JSON.stringify(displayedForemanIds || []) },
        });

        return NextResponse.json({ displayedForemanIds: parseJsonField<string[]>(settings.displayedForemanIds, []) });
    } catch (error) {
        return serverErrorResponse('ユーザー設定の更新', error);
    }
}
