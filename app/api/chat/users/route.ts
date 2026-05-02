import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

/**
 * GET /api/chat/users
 * チャット相手選択用のユーザー一覧（自分以外、有効ユーザーのみ）
 */
export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const users = await prisma.user.findMany({
            where: { isActive: true, id: { not: session!.user.id } },
            select: { id: true, displayName: true, role: true },
            orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
        });

        return NextResponse.json(
            { users },
            { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } }
        );
    } catch (error) {
        return serverErrorResponse('ユーザー一覧取得', error);
    }
}
