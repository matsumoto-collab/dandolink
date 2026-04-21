import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { sendPushToUsers } from '@/lib/push';

/**
 * 手配確定時に確定メンバー（confirmedWorkerIds）へプッシュ通知を送る。
 * 通知内容はサーバ側でassignmentの内容から組み立てる（クライアントからの任意文言は受け付けない）。
 */
export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const body = await request.json().catch(() => ({}));
        const assignmentId: string | undefined = body?.assignmentId;
        if (!assignmentId || typeof assignmentId !== 'string') {
            return validationErrorResponse('assignmentIdが必要です');
        }

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id: assignmentId },
            include: { projectMaster: true },
        });
        if (!assignment) {
            return validationErrorResponse('手配データが見つかりません');
        }

        const confirmedWorkerIds: string[] = assignment.confirmedWorkerIds
            ? (() => {
                try {
                    const parsed = JSON.parse(assignment.confirmedWorkerIds);
                    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
                } catch {
                    return [];
                }
            })()
            : [];

        if (confirmedWorkerIds.length === 0) {
            return NextResponse.json({ sent: 0, removed: 0, failed: 0, reason: 'no-confirmed-workers' });
        }

        const pm = assignment.projectMaster;
        const siteName = pm.name || pm.title || '案件';
        const suffix = pm.constructionSuffixId
            ? (await prisma.constructionSuffix.findUnique({ where: { id: pm.constructionSuffixId } }))?.name
            : undefined;
        const title = suffix ? `${siteName}（${suffix}）` : siteName;

        const dateStr = new Intl.DateTimeFormat('ja-JP', {
            month: 'numeric',
            day: 'numeric',
            weekday: 'short',
        }).format(assignment.date);

        const foreman = await prisma.user.findUnique({ where: { id: assignment.assignedEmployeeId } });
        const foremanName = foreman?.displayName;

        const bodyLines: string[] = [`${dateStr}`];
        if (assignment.meetingTime) bodyLines.push(`集合 ${assignment.meetingTime}`);
        if (foremanName) bodyLines.push(`職長 ${foremanName}`);

        const result = await sendPushToUsers(confirmedWorkerIds, {
            title: `【手配確定】${title}`,
            body: bodyLines.join(' / '),
            url: '/',
            tag: `dispatch-${assignment.id}`,
            data: { assignmentId: assignment.id, projectMasterId: assignment.projectMasterId },
        });

        return NextResponse.json(result);
    } catch (error) {
        return serverErrorResponse('手配確定通知の送信', error);
    }
}
