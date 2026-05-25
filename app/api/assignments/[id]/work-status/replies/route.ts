import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';
import { notifyUsers } from '@/lib/notifications';
import { logger } from '@/lib/logger';
import { toJstDateOnly } from '@/lib/dateUtils';

interface RouteContext {
    params: Promise<{ id: string }>;
}

const createReplySchema = z.object({
    reportType: z.enum(['start', 'end']),
    body: z.string().trim().min(1, '本文を入力してください').max(100, '本文は100文字以内で入力してください'),
});

/**
 * 配置 (assignment) と現在のユーザーから、返信「閲覧」「投稿」可否を返す。
 * - 閲覧可: admin/manager/担当職長本人/確定メンバー/自社班 partner_member
 * - 投稿可: 上記から partner_member を除外（閲覧のみ可）
 */
function resolveReplyPermissions(
    assignment: { assignedEmployeeId: string; confirmedWorkerIds: string | null },
    user: { id: string; role: string; companyId: string | null | undefined }
): { canView: boolean; canPost: boolean } {
    const role = user.role;
    const isManager = role === 'admin' || role === 'manager';
    const isOwner = user.id === assignment.assignedEmployeeId;
    const confirmedWorkerIds = parseJsonField<string[]>(assignment.confirmedWorkerIds, []);
    const isConfirmedWorker = confirmedWorkerIds.includes(user.id);
    const isPartnerCompanyMember =
        role === 'partner_member' &&
        !!user.companyId &&
        user.companyId === assignment.assignedEmployeeId;

    const canView = isManager || isOwner || isConfirmedWorker || isPartnerCompanyMember;
    const canPost = isManager || isOwner || isConfirmedWorker; // partner_member は除外
    return { canView, canPost };
}

/**
 * GET /api/assignments/[id]/work-status/replies
 * 指定配置の返信一覧を時系列で返す。
 */
export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id },
            select: { id: true, assignedEmployeeId: true, confirmedWorkerIds: true },
        });
        if (!assignment) return notFoundResponse('配置');

        const { canView } = resolveReplyPermissions(assignment, {
            id: session!.user.id,
            role: session!.user.role,
            companyId: session!.user.companyId,
        });
        if (!canView) {
            return errorResponse('この案件の返信を閲覧する権限がありません', 403);
        }

        const replies = await prisma.workReportReply.findMany({
            where: { assignmentId: id },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                assignmentId: true,
                reportType: true,
                authorId: true,
                body: true,
                createdAt: true,
            },
        });

        return NextResponse.json(
            {
                replies: replies.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('返信一覧取得', error);
    }
}

/**
 * POST /api/assignments/[id]/work-status/replies
 * body: { reportType: 'start' | 'end', body: string (1〜100文字) }
 */
export async function POST(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;

        const json = await req.json().catch(() => ({}));
        const parsed = createReplySchema.safeParse(json);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }
        const { reportType, body } = parsed.data;

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id },
            select: {
                id: true,
                assignedEmployeeId: true,
                confirmedWorkerIds: true,
                workStartedAt: true,
                workEndedAt: true,
                projectMasterId: true,
                date: true,
            },
        });
        if (!assignment) return notFoundResponse('配置');

        const { canPost } = resolveReplyPermissions(assignment, {
            id: session!.user.id,
            role: session!.user.role,
            companyId: session!.user.companyId,
        });
        if (!canPost) {
            return errorResponse('この案件への返信権限がありません', 403);
        }

        // 開始/完了が押されていない reportType への返信は拒否
        if (reportType === 'start' && !assignment.workStartedAt) {
            return errorResponse('まだ作業開始が報告されていません', 400);
        }
        if (reportType === 'end' && !assignment.workEndedAt) {
            return errorResponse('まだ作業完了が報告されていません', 400);
        }

        const reply = await prisma.workReportReply.create({
            data: {
                assignmentId: id,
                reportType,
                authorId: session!.user.id,
                body,
            },
            select: {
                id: true,
                assignmentId: true,
                reportType: true,
                authorId: true,
                body: true,
                createdAt: true,
            },
        });

        // 通知送信: 担当職長 + admin/manager（自分は除外）
        try {
            const recipients = await prisma.user.findMany({
                where: {
                    isActive: true,
                    OR: [
                        { role: { in: ['admin', 'manager'], mode: 'insensitive' } },
                        { id: assignment.assignedEmployeeId },
                    ],
                    NOT: { id: session!.user.id },
                },
                select: { id: true },
            });
            const userIds = recipients.map((u) => u.id);

            // 該当 DailyReport を特定してディープリンクに使う
            const dateOnly = toJstDateOnly(assignment.date);
            const dailyReport = await prisma.dailyReport.findUnique({
                where: { foremanId_date: { foremanId: assignment.assignedEmployeeId, date: dateOnly } },
                select: { id: true },
            });

            const [author, pm] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: session!.user.id },
                    select: { displayName: true },
                }),
                assignment.projectMasterId
                    ? prisma.projectMaster.findUnique({
                        where: { id: assignment.projectMasterId },
                        select: { name: true, title: true, honorific: true },
                    })
                    : Promise.resolve(null),
            ]);
            const authorName = author?.displayName || '不明';
            const baseName = pm?.name || pm?.title || '案件';
            const siteName = `${baseName}${pm?.honorific || ''}`;
            const actionLabel = reportType === 'start' ? '開始メモ' : '完了メモ';

            const url = dailyReport
                ? `/?page=reports&reportId=${dailyReport.id}`
                : '/?page=reports';

            await notifyUsers({
                userIds,
                type: 'work-report-reply',
                title: `【返信】${siteName}`,
                body: `${authorName}が${actionLabel}に返信: ${body}`,
                url,
                pushTag: `work-report-reply-${reply.id}`,
                projectMasterId: assignment.projectMasterId ?? undefined,
                data: {
                    assignmentId: id,
                    replyId: reply.id,
                    reportType,
                    dailyReportId: dailyReport?.id,
                },
            });
        } catch (e) {
            logger.error('[work-report-reply] notify failed', e);
            // 通知失敗してもAPIは成功扱い
        }

        return NextResponse.json(
            { reply: { ...reply, createdAt: reply.createdAt.toISOString() } },
            { status: 201, headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('返信作成', error);
    }
}
