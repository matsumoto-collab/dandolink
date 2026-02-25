import { withAuth, NextRequestWithAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// 環境変数が設定されているか確認
const isRedisConfigured = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = isRedisConfigured ? Redis.fromEnv() : null;

// API用の全体レートリミット（1分あたり100リクエスト）
const apiRateLimiter = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(100, '60 s'),
        analytics: true,
    })
    : null;

export default withAuth(
    async function middleware(req: NextRequestWithAuth) {
        // APIルートへのアクセスに対してのみレートリミットを適用
        if (req.nextUrl.pathname.startsWith('/api/') && apiRateLimiter) {
            const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
                || req.headers.get('x-real-ip')
                || 'unknown';

            try {
                const { success, limit, remaining, reset } = await apiRateLimiter.limit(ip);
                if (!success) {
                    return NextResponse.json(
                        { error: 'リクエスト数が上限を超えました。しばらく待ってから再試行してください。' },
                        {
                            status: 429,
                            headers: {
                                'X-RateLimit-Limit': limit.toString(),
                                'X-RateLimit-Remaining': remaining.toString(),
                                'X-RateLimit-Reset': reset.toString(),
                                'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
                            },
                        }
                    );
                }
            } catch (error) {
                // Redis通信エラー時はブロックせず通す（フェイルオープン）
                console.error('[Middleware RateLimit Error]', error);
            }
        }

        return NextResponse.next();
    },
    {
        callbacks: {
            authorized: ({ token }) => token?.isActive === true,
        },
    }
);

export const config = {
    matcher: [
        // 認証不要なパスを除外
        // - api/auth: ログインAPI等
        // - api/init-db: DB初期化専用（ユーザーゼロ状態で使用するため除外。本番はroute.ts内でNODE_ENV===productionチェック+INIT_DB_SECRET+レートリミットで保護済み）
        // - login: ログインページ
        // - _next/static, _next/image, favicon.ico: 静的ファイル群
        // - manifest.json, 各種画像ファイル: PWAやアセット用
        // - .*\\.mjs: PDF Worker などの静的スクリプト
        '/((?!api/auth|api/init-db|login|_next/static|_next/image|favicon.ico|manifest\\.json|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.ico|.*\\.mjs).*)',
    ],
};
