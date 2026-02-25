import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!['admin', 'manager', 'foreman1', 'foreman2'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const foremen = await prisma.user.findMany({
            where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json(foremen, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('職長一覧取得', error);
    }
}
