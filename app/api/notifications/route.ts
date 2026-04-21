import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

/**
 * 現在ログイン中ユーザーの通知一覧（新しい順）。
 * ?limit=30 （default 30, max 100）
 */
export async function GET(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const limitParam = Number(searchParams.get('limit') || 30);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 30;

        const rows = await prisma.notification.findMany({
            where: { userId: session!.user.id },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        const unreadCount = await prisma.notification.count({
            where: { userId: session!.user.id, readAt: null },
        });

        return NextResponse.json(
            { items: rows, unreadCount },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('通知一覧の取得', error);
    }
}
