import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';

/**
 * GET /api/schedule-history - スケジュール変更履歴の取得
 * 閲覧権限: admin / manager のみ
 * 直近 limit 件(デフォルト100、最大500)を新しい順で返す
 */
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const { searchParams } = new URL(req.url);
        const limitRaw = Number(searchParams.get('limit') ?? 100);
        const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);

        const histories = await prisma.scheduleChangeHistory.findMany({
            orderBy: { changedAt: 'desc' },
            take: limit,
            include: {
                assignment: {
                    include: {
                        projectMaster: {
                            select: {
                                id: true,
                                title: true,
                                name: true,
                                honorific: true,
                                customerName: true,
                            },
                        },
                    },
                },
            },
        });

        // 変更者名・職長名を一括解決
        const userIds = new Set<string>();
        histories.forEach((h) => {
            userIds.add(h.changedById);
            if (h.changeType === 'foreman') {
                if (h.previousValue) userIds.add(h.previousValue);
                if (h.newValue) userIds.add(h.newValue);
            }
        });
        const users = await prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, displayName: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u.displayName]));

        const formatted = histories.map((h) => ({
            id: h.id,
            assignmentId: h.assignmentId,
            changedAt: h.changedAt.toISOString(),
            changeType: h.changeType,
            previousValue: h.previousValue,
            newValue: h.newValue,
            changedBy: {
                id: h.changedById,
                displayName: userMap.get(h.changedById) ?? '(不明)',
            },
            previousLabel:
                h.changeType === 'foreman'
                    ? userMap.get(h.previousValue) ?? '(不明)'
                    : null,
            newLabel:
                h.changeType === 'foreman'
                    ? userMap.get(h.newValue) ?? '(不明)'
                    : null,
            project: h.assignment?.projectMaster
                ? {
                      id: h.assignment.projectMaster.id,
                      title: h.assignment.projectMaster.title,
                      name: h.assignment.projectMaster.name,
                      honorific: h.assignment.projectMaster.honorific,
                      customerName: h.assignment.projectMaster.customerName,
                  }
                : null,
        }));

        return NextResponse.json(
            { histories: formatted },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('スケジュール変更履歴の取得', error);
    }
}
