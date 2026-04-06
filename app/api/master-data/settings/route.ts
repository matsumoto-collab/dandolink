import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { systemSettingsSchema, validateRequest } from '@/lib/validations';

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
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(systemSettingsSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { totalMembers } = validation.data;

        const settings = await prisma.systemSettings.upsert({ where: { id: 'default' }, update: { totalMembers }, create: { id: 'default', totalMembers } });
        return NextResponse.json(settings);
    } catch (error) {
        return serverErrorResponse('システム設定更新', error);
    }
}
