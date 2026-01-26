import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, stringifyJsonField, serverErrorResponse } from '@/lib/api/utils';

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

        const { displayedForemanIds } = await request.json();
        const settings = await prisma.userSettings.upsert({
            where: { userId: session!.user.id },
            update: { displayedForemanIds: stringifyJsonField(displayedForemanIds || []) },
            create: { userId: session!.user.id, displayedForemanIds: stringifyJsonField(displayedForemanIds || []) },
        });

        return NextResponse.json({ displayedForemanIds: parseJsonField<string[]>(settings.displayedForemanIds, []) });
    } catch (error) {
        return serverErrorResponse('ユーザー設定の更新', error);
    }
}
