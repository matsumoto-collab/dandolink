import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/assignments/[id]/history - この配置の変更履歴（誰が・いつ・何を変えたか）
 *
 * 案件詳細モーダルの「変更履歴」セクション用。作成（created）・各フィールドの変更・
 * 復元（restored）が新しい順で返る。値の整形は記録時に済んでいる（lib/assignmentHistory.ts）。
 * foreman（職長ID保存）だけはここで表示名に解決して previousLabel / newLabel を付ける。
 * 権限: 社員のみ（協力業者 partner/partner_member には出さない）。
 */
export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const role = (session!.user.role as string | undefined)?.toLowerCase() ?? '';
        if (role === 'partner' || role === 'partner_member') {
            return errorResponse('権限がありません', 403);
        }

        const { id } = await context.params;

        const histories = await prisma.scheduleChangeHistory.findMany({
            where: { assignmentId: id },
            orderBy: { changedAt: 'desc' },
            take: 200,
        });

        // 変更者名＋foreman 値（職長ID）の表示名を一括解決
        const userIds = new Set<string>();
        histories.forEach((h) => {
            userIds.add(h.changedById);
            if (h.changeType === 'foreman') {
                if (h.previousValue) userIds.add(h.previousValue);
                if (h.newValue) userIds.add(h.newValue);
            }
        });
        const users = userIds.size
            ? await prisma.user.findMany({
                  where: { id: { in: Array.from(userIds) } },
                  select: { id: true, displayName: true },
              })
            : [];
        const userMap = new Map(users.map((u) => [u.id, u.displayName]));
        const foremanLabel = (v: string): string =>
            v === 'unassigned' ? '未割当（浮き）' : userMap.get(v) ?? '(不明)';

        return NextResponse.json(
            {
                histories: histories.map((h) => ({
                    id: h.id,
                    changedAt: h.changedAt.toISOString(),
                    changedByName: userMap.get(h.changedById) ?? '(不明)',
                    changeType: h.changeType,
                    previousValue: h.previousValue,
                    newValue: h.newValue,
                    previousLabel: h.changeType === 'foreman' ? foremanLabel(h.previousValue) : null,
                    newLabel: h.changeType === 'foreman' ? foremanLabel(h.newValue) : null,
                })),
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('配置の変更履歴の取得', error);
    }
}
