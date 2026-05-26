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
 * 該当月（行の日付が属する JST 月）が「締め扱い」かを判定する。
 * 締め扱い ＝ 同月の有効行（deletedAt=null）が 1 件以上 + 全行 status='completed'
 *
 * 注: GET の monthStatus は「未保存 auto 行も含めて draft が無いか」を見るが、ここではコスト優先で
 *     「保存済み・非削除の行が全て completed」をもって締めと見なす（やや厳しい近似）。
 *     締め後ガードが過剰に発火した場合は、どれか 1 行の完了を解除すれば削除可能になる設計。
 */
async function isMonthLocked(partnerCompanyId: string, dateInMonth: Date): Promise<boolean> {
    // JST 月の境界を UTC で表現（@db.Date は UTC 00:00 基準）
    const y = dateInMonth.getUTCFullYear();
    const m = dateInMonth.getUTCMonth();
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 1));
    const rows = await prisma.partnerWorkVolume.findMany({
        where: {
            partnerCompanyId,
            date: { gte: start, lt: end },
            deletedAt: null,
        },
        select: { status: true },
    });
    if (rows.length === 0) return false;
    return rows.every((r) => r.status === 'completed');
}

/**
 * DELETE /api/partner-work-volume/[id]
 * - sourceAssignmentId あり（auto 行）→ 論理削除（deletedAt セット）。次回 GET で再生成されない。
 * - sourceAssignmentId なし（手動行）→ 物理削除（従来通り）。
 * - admin / manager のみ。
 * - 月の全行が completed（締め状態）の場合は 403 で拒否。
 *   いずれかの行の完了を解除してから再操作する想定。
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (!ADMIN_ROLES.includes(session!.user.role)) {
            return errorResponse('管理者またはマネージャー権限が必要です', 403);
        }

        const { id } = await context.params;
        const userId = session!.user.id as string;

        const record = await prisma.partnerWorkVolume.findUnique({ where: { id } });
        if (!record) return errorResponse('対象の行が見つかりません', 404);

        // 締め後ガード（admin/manager でも削除を防ぐ。完了を解除すれば解除される）
        if (await isMonthLocked(record.partnerCompanyId, record.date)) {
            return errorResponse(
                '月の全行が完了状態のため削除できません。いずれかの行の完了を解除してから再操作してください。',
                403
            );
        }

        if (record.sourceAssignmentId) {
            // auto 行: 論理削除（次回 GET で auto 再生成も抑止される）
            await prisma.partnerWorkVolume.update({
                where: { id },
                data: { deletedAt: new Date(), deletedBy: userId },
            });
        } else {
            // 手動行: 物理削除
            await prisma.partnerWorkVolume.delete({ where: { id } });
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        return serverErrorResponse('協力会社出来高削除', err);
    }
}
