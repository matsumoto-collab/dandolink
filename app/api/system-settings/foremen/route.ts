import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
        return NextResponse.json({
            displayedForemanIds: settings ? parseJsonField<string[]>(settings.displayedForemanIds, []) : [],
        });
    } catch (error) {
        return serverErrorResponse('職長表示設定の取得', error);
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { displayedForemanIds } = await request.json();
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
