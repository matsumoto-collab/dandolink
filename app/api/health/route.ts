import { NextResponse } from 'next/server';

/**
 * 死活監視用エンドポイント。
 * - 認証不要 (middleware.ts の matcher で除外)
 * - DB チェック等は行わず、Lambda が生きていることだけを保証する
 * - UptimeRobot 等の外部監視サービスから利用する想定
 */
export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET() {
    return NextResponse.json(
        { status: 'ok', ts: Date.now() },
        {
            status: 200,
            headers: {
                'Cache-Control': 'no-store, must-revalidate',
            },
        }
    );
}
