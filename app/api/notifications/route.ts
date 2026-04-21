import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

/**
 * 現在ログイン中ユーザーの通知一覧（新しい順）。
 * ?limit=5 （default 5, max 100）
 * hasMore: limit を超える件数が存在する場合 true
 */
export async function GET(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const limitParam = Number(searchParams.get('limit') || 5);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 5;

        // +1件余分に取得して hasMore を判定
        const rows = await prisma.notification.findMany({
            where: { userId: session!.user.id },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
        });
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;

        const unreadCount = await prisma.notification.count({
            where: { userId: session!.user.id, readAt: null },
        });

        return NextResponse.json(
            { items, unreadCount, hasMore },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('通知一覧の取得', error);
    }
}
