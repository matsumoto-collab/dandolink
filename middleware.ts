import { withAuth, NextRequestWithAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

// 環境変数が設定されているか確認
const isRedisConfigured = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = isRedisConfigured ? Redis.fromEnv() : null;

// API用の全体レートリミット（1分あたり200リクエスト）
const apiRateLimiter = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(200, '60 s'),
        analytics: true,
    })
    : null;

// Redis未設定時のインメモリ・フォールバック
// Lambdaインスタンス単位の保護なので分散環境では完全ではないが、
// 単一ユーザーが warm Lambda に固まりがちなバースト（同一接続で連投）に対しては有効。
// 過去事故 (2026-04-27): Upstash 未設定で完全無防備の状態で
// 1ユーザーが20req/秒の暴走を起こし DB 接続を枯渇させた。
const MEMORY_LIMIT = 200;
const MEMORY_WINDOW_MS = 60_000;
interface MemoryBucket { count: number; resetAt: number }
const memoryBuckets = new Map<string, MemoryBucket>();

function checkMemoryRateLimit(key: string): { success: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    // メモリ肥大化防止: 上限超え時に期限切れエントリを掃除
    if (memoryBuckets.size > 5000) {
        for (const [k, v] of memoryBuckets) {
            if (v.resetAt <= now) memoryBuckets.delete(k);
        }
    }
    const existing = memoryBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
        memoryBuckets.set(key, { count: 1, resetAt: now + MEMORY_WINDOW_MS });
        return { success: true, remaining: MEMORY_LIMIT - 1, resetAt: now + MEMORY_WINDOW_MS };
    }
    existing.count++;
    return {
        success: existing.count <= MEMORY_LIMIT,
        remaining: Math.max(0, MEMORY_LIMIT - existing.count),
        resetAt: existing.resetAt,
    };
}

export default withAuth(
    async function middleware(req: NextRequestWithAuth) {
        // APIルートへのアクセスに対してのみレートリミットを適用
        if (req.nextUrl.pathname.startsWith('/api/')) {
            // 未認証 API リクエストは HTML リダイレクトではなく JSON 401 を返す
            // （フロントが res.json() で SyntaxError にならないように、また監視が誤って 200 と判定しないように）
            const token = req.nextauth?.token;
            if (!token || token.isActive !== true) {
                return NextResponse.json(
                    { error: 'Unauthorized' },
                    { status: 401 }
                );
            }

            // 認証済みなら userId をキーに（同一拠点NAT配下で誤発動するのを防ぐ）
            // 未認証は IP にフォールバック
            const userId = (req.nextauth?.token?.sub || req.nextauth?.token?.id) as string | undefined;
            const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
                || req.headers.get('x-real-ip')
                || 'unknown';
            const limitKey = userId ? `user:${userId}` : `ip:${ip}`;

            // Upstash 利用可能ならそちらで分散レート制限、未設定なら in-memory フォールバック
            try {
                if (apiRateLimiter) {
                    const { success, limit, remaining, reset } = await apiRateLimiter.limit(limitKey);
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
                } else {
                    const { success, remaining, resetAt } = checkMemoryRateLimit(limitKey);
                    if (!success) {
                        return NextResponse.json(
                            { error: 'リクエスト数が上限を超えました。しばらく待ってから再試行してください。' },
                            {
                                status: 429,
                                headers: {
                                    'X-RateLimit-Limit': MEMORY_LIMIT.toString(),
                                    'X-RateLimit-Remaining': remaining.toString(),
                                    'X-RateLimit-Reset': resetAt.toString(),
                                    'Retry-After': Math.ceil((resetAt - Date.now()) / 1000).toString(),
                                },
                            }
                        );
                    }
                }
            } catch (error) {
                // Rate limit 評価自体のエラー時はブロックせず通す（フェイルオープン）
                logger.error('[Middleware RateLimit Error]', error);
            }
        }

        return NextResponse.next();
    },
    {
        callbacks: {
            authorized: ({ token, req }) => {
                // /api/* は middleware 本体で JSON 401 を返すため、ここでは常に通す
                // （false を返すと NextAuth のデフォルトでログインページHTMLにリダイレクトされてしまう）
                if (req.nextUrl.pathname.startsWith('/api/')) return true;
                return token?.isActive === true;
            },
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
