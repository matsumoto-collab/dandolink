import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        let settings = await prisma.systemSettings.findFirst({ where: { id: 'default' } });
        if (!settings) {
            settings = await prisma.systemSettings.create({ data: { id: 'default', totalMembers: 20 } });
        }
        return NextResponse.json(settings);
    } catch (error) {
        return serverErrorResponse('システム設定取得', error);
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { totalMembers } = await request.json();
        if (typeof totalMembers !== 'number' || totalMembers < 1) {
            return validationErrorResponse('totalMembersは1以上の数値が必要です');
        }

        const settings = await prisma.systemSettings.upsert({ where: { id: 'default' }, update: { totalMembers }, create: { id: 'default', totalMembers } });
        return NextResponse.json(settings);
    } catch (error) {
        return serverErrorResponse('システム設定更新', error);
    }
}
