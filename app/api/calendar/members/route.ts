import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const users = await prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, displayName: true },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json(users, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('メンバー一覧取得', error);
    }
}
