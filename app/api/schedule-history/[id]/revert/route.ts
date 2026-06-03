import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { formatAssignment } from '@/lib/formatters';

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * POST /api/schedule-history/[id]/revert - スケジュール変更履歴（移動）を元に戻す。
 * 対象: changeType が 'date'（日付移動）/ 'foreman'（職長変更）の履歴。
 * 配置を previousValue へ戻し、逆向きの履歴を1件記録する（監査の整合・パネル再表示のため）。
 * 権限: admin / manager のみ。
 */
export async function POST(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const { id } = await context.params;

        const history = await prisma.scheduleChangeHistory.findUnique({ where: { id } });
        if (!history) return notFoundResponse('変更履歴');
        if (history.changeType !== 'date' && history.changeType !== 'foreman') {
            return errorResponse('この履歴は元に戻せません', 400);
        }

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id: history.assignmentId },
        });
        if (!assignment) {
            return errorResponse('対象の配置が見つかりません（削除された可能性があります）', 404);
        }

        const data: Record<string, unknown> = { updatedBy: session!.user.id };
        if (history.changeType === 'date') {
            data.date = new Date(history.previousValue);
        } else {
            data.assignedEmployeeId = history.previousValue;
        }

        const updated = await prisma.projectAssignment.update({
            where: { id: history.assignmentId },
            data,
            include: { projectMaster: true },
        });

        // 逆向きの履歴を記録（現在値→戻す先）。監査として残し、パネルにも反映させる。
        await prisma.scheduleChangeHistory.create({
            data: {
                assignmentId: history.assignmentId,
                changedById: session!.user.id,
                changeType: history.changeType,
                previousValue: history.newValue,
                newValue: history.previousValue,
            },
        });

        return NextResponse.json(formatAssignment(updated));
    } catch (error) {
        return serverErrorResponse('スケジュール変更の取り消し', error);
    }
}
