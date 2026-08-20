import { NextRequest, NextResponse } from 'next/server';
import { runBillingWatch } from '@/lib/billingWatch';
import { logger } from '@/lib/logger';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/billing-watch - 請求漏れの見張り（Vercel Cron から 7時 / 15時 JST に実行）
 *
 * vercel.json の crons で 22:00 UTC（=翌7:00 JST）と 06:00 UTC（=15:00 JST）に起動。
 * schedule-watch と同様に CRON_SECRET を `Authorization: Bearer <secret>` で検証する。
 */
export async function GET(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        logger.error('[cron/billing-watch] CRON_SECRET が未設定のため実行を拒否しました');
        return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
    }
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await runBillingWatch();
        logger.info(
            `[cron/billing-watch] 完了: 判断待ち${result.detected}件 / 通知${result.notifiedUsers}人`
        );
        return NextResponse.json({ ok: true, ...result });
    } catch (e) {
        logger.error('[cron/billing-watch] 実行に失敗', e);
        return NextResponse.json({ error: 'billing watch failed' }, { status: 500 });
    }
}
