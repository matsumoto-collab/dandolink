import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!['admin', 'manager', 'foreman1', 'worker'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const workers = await prisma.user.findMany({
            where: { isActive: true, role: { in: ['worker', 'WORKER', 'foreman2', 'FOREMAN2', 'foreman1', 'FOREMAN1', 'admin', 'ADMIN', 'manager', 'MANAGER'] } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json(workers, { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' } });
    } catch (error) {
        return serverErrorResponse('ワーカー一覧取得', error);
    }
}
