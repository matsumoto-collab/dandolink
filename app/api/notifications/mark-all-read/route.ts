import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function POST() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const result = await prisma.notification.updateMany({
            where: { userId: session!.user.id, readAt: null },
            data: { readAt: new Date() },
        });

        return NextResponse.json({ updated: result.count });
    } catch (error) {
        return serverErrorResponse('通知の一括既読', error);
    }
}
