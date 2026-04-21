import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';

export async function PATCH(
    _request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const id = params.id;
        if (!id) return validationErrorResponse('idが必要です');

        // 他人の通知を誤って既読化しないよう userId も条件に含める
        const result = await prisma.notification.updateMany({
            where: { id, userId: session!.user.id, readAt: null },
            data: { readAt: new Date() },
        });

        return NextResponse.json({ updated: result.count });
    } catch (error) {
        return serverErrorResponse('通知の既読化', error);
    }
}
