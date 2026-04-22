import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { formatAssignment } from '@/lib/formatters';
import { notifyUsers } from '@/lib/notifications';
import { logger } from '@/lib/logger';

interface RouteContext {
    params: Promise<{ id: string }>;
}

/** 現在時刻を最も近い15分単位（0/15/30/45）に四捨五入して "HH:MM" を返す */
function roundToNearestQuarterHour(now: Date): { timeStr: string; rounded: Date } {
    const rounded = new Date(now);
    const minutes = now.getMinutes();
    const remainder = minutes % 15;
    const delta = remainder < 8 ? -remainder : 15 - remainder;
    rounded.setMinutes(minutes + delta, 0, 0);
    const hh = rounded.getHours().toString().padStart(2, '0');
    const mm = rounded.getMinutes().toString().padStart(2, '0');
    return { timeStr: `${hh}:${mm}`, rounded };
}

/** 日付部分のみ抽出（時刻は00:00:00にした Date） */
function toDateOnly(d: Date): Date {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
}

/**
 * POST /api/assignments/[id]/work-status
 * body: { type: 'start' | 'end' }
 * - 現在時刻を15分単位に丸めて workStartedAt/workEndedAt に保存
 * - 同じ案件で既に通知済みの場合は409でブロック
 * - 日報のstartTime/endTimeも同時に更新（存在しなければDailyReport + WorkItemを作成）
 * - 管理者・マネージャー・全職長にプッシュ通知を送信
 */
export async function POST(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const body = await req.json().catch(() => ({}));
        const type: unknown = body?.type;
        if (type !== 'start' && type !== 'end') {
            return validationErrorResponse('type は start または end を指定してください');
        }

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id },
            include: { projectMaster: true },
        });
        if (!assignment) return notFoundResponse('配置');

        // 権限: 担当職長本人 もしくは admin/manager のみ押せる
        const role = session!.user.role;
        const isOwner = session!.user.id === assignment.assignedEmployeeId;
        const isManager = role === 'admin' || role === 'manager';
        if (!isOwner && !isManager) {
            return errorResponse('この案件の開始/終了を通知する権限がありません', 403);
        }

        // 重複ブロック
        if (type === 'start' && assignment.workStartedAt) {
            return NextResponse.json(
                { error: 'この案件は既に作業開始が通知されています', code: 'ALREADY_STARTED' },
                { status: 409 }
            );
        }
        if (type === 'end' && assignment.workEndedAt) {
            return NextResponse.json(
                { error: 'この案件は既に作業終了が通知されています', code: 'ALREADY_ENDED' },
                { status: 409 }
            );
        }

        const now = new Date();
        const { timeStr, rounded } = roundToNearestQuarterHour(now);

        // 1. 配置本体を更新（通知済みフラグをセット）
        const updated = await prisma.projectAssignment.update({
            where: { id },
            data: type === 'start'
                ? { workStartedAt: rounded }
                : { workEndedAt: rounded },
            include: { projectMaster: true, assignmentWorkers: true, assignmentVehicles: true },
        });

        // 2. 日報の該当案件のstartTime/endTimeを更新（upsert）
        try {
            const dateOnly = toDateOnly(assignment.date);
            const foremanId = assignment.assignedEmployeeId;

            const report = await prisma.dailyReport.upsert({
                where: { foremanId_date: { foremanId, date: dateOnly } },
                create: {
                    foremanId,
                    date: dateOnly,
                    updatedBy: session!.user.id,
                },
                update: { updatedBy: session!.user.id },
            });

            const existingItem = await prisma.dailyReportWorkItem.findFirst({
                where: { dailyReportId: report.id, assignmentId: id },
            });

            if (existingItem) {
                await prisma.dailyReportWorkItem.update({
                    where: { id: existingItem.id },
                    data: type === 'start' ? { startTime: timeStr } : { endTime: timeStr },
                });
            } else {
                await prisma.dailyReportWorkItem.create({
                    data: {
                        dailyReportId: report.id,
                        assignmentId: id,
                        startTime: type === 'start' ? timeStr : null,
                        endTime: type === 'end' ? timeStr : null,
                    },
                });
            }
        } catch (e) {
            logger.error('[work-status] DailyReport upsert failed', e);
            // 通知自体は継続する
        }

        // 3. 通知送信（admin/manager/foreman1/foreman2）
        try {
            const recipients = await prisma.user.findMany({
                where: {
                    isActive: true,
                    role: { in: ['admin', 'manager', 'foreman1', 'foreman2'] },
                },
                select: { id: true },
            });
            const userIds = recipients.map((u) => u.id);

            const foreman = await prisma.user.findUnique({
                where: { id: assignment.assignedEmployeeId },
                select: { displayName: true },
            });
            const teamName = foreman?.displayName ? `${foreman.displayName}班` : '班';

            const pm = assignment.projectMaster;
            const siteName = pm.name || pm.title || '案件';
            const suffix = pm.constructionSuffixId
                ? (await prisma.constructionSuffix.findUnique({ where: { id: pm.constructionSuffixId } }))?.name
                : undefined;
            const siteTitle = suffix ? `${siteName}（${suffix}）` : siteName;

            const actionLabel = type === 'start' ? '作業開始' : '作業終了';
            const verb = type === 'start' ? '作業開始しました' : '作業終了しました';
            await notifyUsers({
                userIds,
                type: type === 'start' ? 'work-started' : 'work-ended',
                title: `【${actionLabel}】${teamName}`,
                body: `${siteTitle} ${timeStr} から${verb}`,
                url: '/',
                pushTag: `work-${type}-${assignment.id}`,
                data: {
                    assignmentId: assignment.id,
                    projectMasterId: assignment.projectMasterId,
                    time: timeStr,
                },
            });
        } catch (e) {
            logger.error('[work-status] notify failed', e);
        }

        return NextResponse.json({
            assignment: formatAssignment(updated),
            time: timeStr,
        });
    } catch (error) {
        return serverErrorResponse('作業状況の更新', error);
    }
}
