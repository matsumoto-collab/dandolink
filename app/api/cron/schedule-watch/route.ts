import { NextRequest, NextResponse } from 'next/server';
import { runScheduleWatch } from '@/lib/scheduleWatch';
import { logger } from '@/lib/logger';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/schedule-watch - 朝の見張りまとめ（Vercel Cron から毎朝実行）
 *
 * vercel.json の crons で毎朝 7:00 JST（= 22:00 UTC）に起動。
 * Vercel はプロジェクトの環境変数 CRON_SECRET を `Authorization: Bearer <secret>` で
 * 送ってくるため、それを検証する。CRON_SECRET 未設定時は誰でも叩けてしまうので拒否する
 * （導入時に Vercel の環境変数へ CRON_SECRET を設定すること）。
 */
export async function GET(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        logger.error('[cron/schedule-watch] CRON_SECRET が未設定のため実行を拒否しました');
        return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
    }
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await runScheduleWatch();
        logger.info(
            `[cron/schedule-watch] 完了: 検知${result.detected}件 / 通知${result.notifiedUsers}人`
        );
        return NextResponse.json({ ok: true, ...result });
    } catch (e) {
        logger.error('[cron/schedule-watch] 実行に失敗', e);
        return NextResponse.json({ error: 'schedule watch failed' }, { status: 500 });
    }
}
