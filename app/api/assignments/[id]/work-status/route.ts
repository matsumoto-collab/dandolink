import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';
import { formatAssignment } from '@/lib/formatters';
import { notifyUsers } from '@/lib/notifications';
import { logger } from '@/lib/logger';

type ImageCategory = 'assembly' | 'demolition' | 'other';
const IMAGE_CATEGORIES: ImageCategory[] = ['assembly', 'demolition', 'other'];
const CATEGORY_LABELS: Record<ImageCategory, string> = {
    assembly: '組立',
    demolition: '解体',
    other: 'その他',
};

interface RouteContext {
    params: Promise<{ id: string }>;
}

/** 現在時刻をJSTで最も近い15分単位（0/15/30/45）に四捨五入し、JSTの "HH:MM" と丸め後Dateを返す */
function roundToNearestQuarterHourJst(now: Date): { timeStr: string; rounded: Date } {
    // JST(UTC+9)上の時/分を取り出す
    const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
    const jst = new Date(jstMs);
    const jstHour = jst.getUTCHours();
    const jstMinute = jst.getUTCMinutes();

    const remainder = jstMinute % 15;
    const delta = remainder < 8 ? -remainder : 15 - remainder;

    const totalMinJst = jstHour * 60 + jstMinute + delta;
    const normalized = ((totalMinJst % 1440) + 1440) % 1440;
    const rh = Math.floor(normalized / 60);
    const rm = normalized % 60;
    const timeStr = `${rh.toString().padStart(2, '0')}:${rm.toString().padStart(2, '0')}`;

    // DB保存用: 丸め後のUTC Date（絶対時刻としての now + delta分）
    const rounded = new Date(now);
    rounded.setUTCSeconds(0, 0);
    rounded.setUTCMinutes(rounded.getUTCMinutes() + delta);

    return { timeStr, rounded };
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

        const rawComment: unknown = body?.comment;
        let comment: string | null = null;
        if (rawComment !== undefined && rawComment !== null) {
            if (typeof rawComment !== 'string') {
                return validationErrorResponse('comment は文字列で指定してください');
            }
            const trimmed = rawComment.trim();
            if (trimmed.length > 100) {
                return validationErrorResponse('コメントは100文字以内で入力してください');
            }
            comment = trimmed.length > 0 ? trimmed : null;
        }

        // 画像アップロード件数・カテゴリ（クライアントが先に/api/project-masters/[id]/filesへアップロード済みの想定）
        let imageCategory: ImageCategory | null = null;
        const rawImageCategory: unknown = body?.imageCategory;
        if (typeof rawImageCategory === 'string' && IMAGE_CATEGORIES.includes(rawImageCategory as ImageCategory)) {
            imageCategory = rawImageCategory as ImageCategory;
        }
        const rawUploadedCount: unknown = body?.uploadedImageCount;
        const uploadedImageCount = typeof rawUploadedCount === 'number' && rawUploadedCount > 0
            ? Math.floor(rawUploadedCount)
            : 0;

        const assignment = await prisma.projectAssignment.findUnique({
            where: { id },
            include: { projectMaster: true },
        });
        if (!assignment) return notFoundResponse('配置');

        // 権限: 担当職長本人 / 確定メンバー / admin・manager のみ押せる
        const role = session!.user.role;
        const isOwner = session!.user.id === assignment.assignedEmployeeId;
        const isManager = role === 'admin' || role === 'manager';
        const confirmedWorkerIds = parseJsonField<string[]>(assignment.confirmedWorkerIds, []);
        const isConfirmedWorker = confirmedWorkerIds.includes(session!.user.id);
        if (!isOwner && !isManager && !isConfirmedWorker) {
            return errorResponse('この案件の開始/終了を通知する権限がありません', 403);
        }

        const now = new Date();
        const { timeStr, rounded } = roundToNearestQuarterHourJst(now);

        // 1. 配置本体を更新（担当職長は常に上書き、それ以外は最初の押下のみ反映）
        const canOverwriteAssignmentTime =
            isOwner ||
            (type === 'start' && !assignment.workStartedAt) ||
            (type === 'end' && !assignment.workEndedAt);

        const updated = canOverwriteAssignmentTime
            ? await prisma.projectAssignment.update({
                where: { id },
                data: type === 'start'
                    ? { workStartedAt: rounded, workStartedComment: comment }
                    : { workEndedAt: rounded, workEndedComment: comment },
                include: { projectMaster: true, assignmentWorkers: true, assignmentVehicles: true },
            })
            : await prisma.projectAssignment.findUniqueOrThrow({
                where: { id },
                include: { projectMaster: true, assignmentWorkers: true, assignmentVehicles: true },
            });

        // 2. 担当職長の日報のWorkItemに開始/終了時刻を反映（upsert）
        //    押下者が2番手等であっても、書き込み先は assignedEmployeeId の日報に統一する
        //    （職長の日報を共有編集するイメージ。別レコードを作らない）
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
                    role: { in: ['admin', 'manager', 'foreman1', 'foreman2'], mode: 'insensitive' },
                },
                select: { id: true },
            });
            const userIds = recipients.map((u) => u.id);
            logger.info('[work-status] notify recipients', { count: userIds.length, type });

            // 担当職長と押下者を並行取得
            const [foreman, pressor] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: assignment.assignedEmployeeId },
                    select: { displayName: true },
                }),
                isOwner
                    ? Promise.resolve(null)
                    : prisma.user.findUnique({
                        where: { id: session!.user.id },
                        select: { displayName: true },
                    }),
            ]);
            const teamName = foreman?.displayName ? `${foreman.displayName}班` : '班';
            // 押下者が担当職長と異なる場合はタイトルに押下者名を含める
            const titleSuffix = pressor?.displayName
                ? `${pressor.displayName}（${teamName}）`
                : teamName;

            const pm = assignment.projectMaster;
            const baseName = pm.name || pm.title || '案件';
            const honorific = pm.honorific || '';
            const siteName = `${baseName}${honorific}`;
            const suffix = pm.constructionSuffixId
                ? (await prisma.constructionSuffix.findUnique({ where: { id: pm.constructionSuffixId } }))?.name
                : undefined;
            const siteTitle = suffix ? `${siteName}（${suffix}）` : siteName;
            const clientName = pm.customerShortName || pm.customerName || '';

            const actionLabel = type === 'start' ? '作業開始' : '作業完了';
            const bodyLine = type === 'start'
                ? `${siteTitle} ${timeStr} から作業開始しました`
                : `${siteTitle} ${timeStr} に作業完了しました`;
            const bodyWithClient = clientName ? `${bodyLine}\n元請：${clientName}` : bodyLine;
            const bodyWithComment = comment ? `${bodyWithClient}\nメモ：${comment}` : bodyWithClient;
            const bodyWithImages = (uploadedImageCount > 0 && imageCategory)
                ? `${bodyWithComment}\n${CATEGORY_LABELS[imageCategory]}に${uploadedImageCount}枚画像保存されました`
                : bodyWithComment;
            const notifyUrl = (uploadedImageCount > 0 && assignment.projectMasterId)
                ? `/?page=project-masters&pmId=${assignment.projectMasterId}&scrollTo=files`
                : '/?page=reports';
            await notifyUsers({
                userIds,
                type: type === 'start' ? 'work-started' : 'work-ended',
                title: `【${actionLabel}】${titleSuffix}`,
                body: bodyWithImages,
                url: notifyUrl,
                // 再押下のたびに別通知として通知するため時刻をtagに含める
                pushTag: `work-${type}-${assignment.id}-${timeStr}`,
                data: {
                    assignmentId: assignment.id,
                    projectMasterId: assignment.projectMasterId,
                    time: timeStr,
                    comment: comment ?? undefined,
                    imageCategory: imageCategory ?? undefined,
                    imageCount: uploadedImageCount || undefined,
                },
            });
        } catch (e) {
            logger.error('[work-status] notify failed', e);
        }

        return NextResponse.json({
            assignment: formatAssignment(updated),
            time: timeStr,
            uploadedImageCount,
            imageCategory: imageCategory ?? null,
        });
    } catch (error) {
        return serverErrorResponse('作業状況の更新', error);
    }
}
