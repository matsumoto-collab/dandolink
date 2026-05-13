import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { notifyUsers } from '@/lib/notifications';
import { logger } from '@/lib/logger';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/**
 * 定数時間で文字列を比較する（タイミング攻撃対策）。
 */
function constantTimeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

/**
 * 道路使用許可の期限アラート
 *
 * POST /api/company-calendar/check-expiry?days=7
 *   - 引数 days で何日以内の期限を対象にするか指定（デフォルト 7）
 *   - 該当する ProjectMaster を抽出し、admin / manager 全員に通知を送る
 *   - 二重通知防止: 同じ projectMasterId + expiryDate に対して同日中の通知は重複させない
 *
 * 認可:
 *   - Authorization: Bearer ${CRON_SECRET}
 *     を要求（外部 cron / Vercel Cron / Supabase Scheduled Function などから呼び出す想定）
 *   - CRON_SECRET 未設定の場合は開発環境（NODE_ENV !== 'production'）の localhost からのみ許可
 *   - 本番で CRON_SECRET 未設定の場合は 503 を返す
 */
export async function POST(req: NextRequest) {
    // 認可: CRON_SECRET と一致するかチェック
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') ?? '';
    if (cronSecret) {
        if (!auth || !constantTimeEqual(auth, `Bearer ${cronSecret}`)) {
            return NextResponse.json(
                { error: 'unauthorized' },
                { status: 401, headers: NO_STORE_HEADERS },
            );
        }
    } else {
        // 本番で CRON_SECRET 未設定は明確にエラーにする
        if (process.env.NODE_ENV === 'production') {
            return NextResponse.json(
                { error: 'CRON_SECRET is not configured' },
                { status: 503, headers: NO_STORE_HEADERS },
            );
        }
        // 開発用: localhost 以外は拒否
        const host = req.headers.get('host') ?? '';
        if (!host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
            return NextResponse.json(
                { error: 'CRON_SECRET 未設定のため本番では呼び出せません' },
                { status: 401, headers: NO_STORE_HEADERS },
            );
        }
    }

    try {
        const url = new URL(req.url);
        const daysParam = Number(url.searchParams.get('days') ?? '7');
        const days = Number.isFinite(daysParam) && daysParam >= 0 && daysParam <= 365
            ? Math.floor(daysParam)
            : 7;

        const now = new Date();
        const thresholdEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

        // 期限が「今日〜days日後」までの案件を抽出
        const projects = await prisma.projectMaster.findMany({
            where: {
                roadPermitExpiryDate: {
                    gte: now,
                    lte: thresholdEnd,
                },
                status: { in: ['active', 'completed'] },
            },
            select: {
                id: true,
                title: true,
                roadPermitExpiryDate: true,
            },
        });

        if (projects.length === 0) {
            return NextResponse.json(
                {
                    checked: 0,
                    notified: 0,
                    recipients: 0,
                    days,
                    message: '対象案件はありません',
                },
                { headers: NO_STORE_HEADERS },
            );
        }

        // 通知対象ユーザー（admin / manager）
        const admins = await prisma.user.findMany({
            where: {
                role: { in: ['admin', 'manager'] },
                isActive: true,
                isLoginEnabled: true,
            },
            select: { id: true },
        });
        const recipientIds = admins.map((u) => u.id);

        if (recipientIds.length === 0) {
            return NextResponse.json(
                {
                    checked: projects.length,
                    notified: 0,
                    recipients: 0,
                    days,
                    message: '通知対象ユーザーがいません',
                },
                { headers: NO_STORE_HEADERS },
            );
        }

        let notifiedCount = 0;
        const todayKey = new Date().toISOString().slice(0, 10);

        for (const pm of projects) {
            if (!pm.roadPermitExpiryDate) continue;

            // 二重通知防止: 同 projectMasterId に対して当日中の重複通知はスキップ
            // Notification.data (Json) を構造化フィルタで検索する
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const existing = await prisma.notification.findFirst({
                where: {
                    type: 'road_permit_expiry',
                    createdAt: { gte: startOfDay },
                    data: {
                        path: ['projectMasterId'],
                        equals: pm.id,
                    },
                },
                select: { id: true },
            });
            if (existing) continue;

            const expiryDate = pm.roadPermitExpiryDate;
            const remainMs = expiryDate.getTime() - now.getTime();
            const remainDays = Math.max(0, Math.ceil(remainMs / (24 * 60 * 60 * 1000)));
            const dateLabel = `${expiryDate.getFullYear()}/${expiryDate.getMonth() + 1}/${expiryDate.getDate()}`;

            try {
                const result = await notifyUsers({
                    userIds: recipientIds,
                    type: 'road_permit_expiry',
                    title: `道路使用許可の期限が近づいています（あと${remainDays}日）`,
                    body: `案件「${pm.title}」の道路使用許可期限が ${dateLabel} です`,
                    url: `/?page=company-calendar&pmId=${pm.id}`,
                    data: {
                        projectMasterId: pm.id,
                        expiryDate: expiryDate.toISOString(),
                        dedupeDate: todayKey,
                    },
                    pushTag: `road_permit_expiry_${pm.id}`,
                });
                notifiedCount += result.notificationIds.length;
            } catch (e) {
                logger.error('[CompanyCalendar] notify failed', e);
            }
        }

        return NextResponse.json(
            {
                checked: projects.length,
                notified: notifiedCount,
                recipients: recipientIds.length,
                days,
            },
            { headers: NO_STORE_HEADERS },
        );
    } catch (err) {
        logger.error('[CompanyCalendar] check-expiry failed', err);
        return NextResponse.json(
            { error: '期限チェックに失敗しました' },
            { status: 500, headers: NO_STORE_HEADERS },
        );
    }
}

// GET は動作確認用に状態を返す（認可は同じ）
export async function GET(req: NextRequest) {
    return POST(req);
}
