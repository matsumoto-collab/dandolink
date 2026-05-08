import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner', 'partner_member'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const { searchParams } = new URL(req.url);
        const scope = searchParams.get('scope');

        const baseRoles = ['foreman1', 'foreman2', 'admin', 'manager', 'partner'];
        const allowedRoles = (scope === 'schedule' && role === 'foreman2')
            ? baseRoles.filter(r => r !== 'partner')
            : baseRoles;

        const foremen = await prisma.user.findMany({
            where: { isActive: true, role: { in: allowedRoles, mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json(foremen, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120, must-revalidate' } });
    } catch (error) {
        return serverErrorResponse('職長一覧取得', error);
    }
}
