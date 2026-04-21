import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const count = await prisma.notification.count({
            where: { userId: session!.user.id, readAt: null },
        });

        return NextResponse.json(
            { count },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('未読件数の取得', error);
    }
}
