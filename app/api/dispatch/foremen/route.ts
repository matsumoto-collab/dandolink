import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Get foremen for dispatch assignment
 * GET /api/dispatch/foremen
 * Available for: admin, manager, foreman1
 */
export async function GET(_req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const role = session.user.role;

        // Check dispatch permission
        if (role !== 'admin' && role !== 'manager' && role !== 'foreman1') {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        // Get users with foreman1 or foreman2 role
        const foremen = await prisma.user.findMany({
            where: {
                isActive: true,
                role: {
                    in: ['foreman1', 'FOREMAN1', 'foreman2', 'FOREMAN2'],
                },
            },
            select: {
                id: true,
                displayName: true,
                role: true,
            },
            orderBy: {
                displayName: 'asc',
            },
        });

        return NextResponse.json(foremen);
    } catch (error) {
        console.error('Get dispatch foremen error:', error);
        return NextResponse.json(
            { error: '職長一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}
