import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    serverErrorResponse,
} from '@/lib/api/utils';

const ADMIN_ROLES = ['admin', 'manager'];

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * DELETE /api/partner-work-volume/[id]
 * 保存済みの出来高行を削除（admin / manager のみ）
 * 自動生成元の配置データには影響しない（再度 GET すると未保存の auto row として再出現）
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (!ADMIN_ROLES.includes(session!.user.role)) {
            return errorResponse('管理者またはマネージャー権限が必要です', 403);
        }

        const { id } = await context.params;
        await prisma.partnerWorkVolume.delete({ where: { id } });

        return NextResponse.json({ ok: true });
    } catch (err) {
        return serverErrorResponse('協力会社出来高削除', err);
    }
}
