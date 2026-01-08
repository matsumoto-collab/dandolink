import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Get workers for dispatch assignment
 * GET /api/dispatch/workers
 * Available for: admin, manager, foreman1
 */
export async function GET(_req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const role = session.user.role;

        // Check dispatch permission (worker allowed for viewing their own assignments)
        if (role !== 'admin' && role !== 'manager' && role !== 'foreman1' && role !== 'worker') {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        // Get users with worker role (including foreman2 for worker selection)
        const workers = await prisma.user.findMany({
            where: {
                isActive: true,
                role: {
                    in: ['worker', 'WORKER', 'foreman2', 'FOREMAN2', 'foreman1', 'FOREMAN1', 'admin', 'ADMIN', 'manager', 'MANAGER'],
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

        return NextResponse.json(workers);
    } catch (error) {
        console.error('Get dispatch workers error:', error);
        return NextResponse.json(
            { error: 'ワーカー一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}
