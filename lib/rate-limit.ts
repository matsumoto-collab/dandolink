import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * 分散Rate Limiter (Upstash Redis利用)
 * サーバーレス環境でも正確にグローバルなリクエスト制限を行います。
 */

// Redisインスタンスの初期化（URLとTokenが設定されていない場合はモックとして動作しないように注意）
let redis: Redis | null = null;
try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
    }
} catch (e) {
    console.error('Redis initialization error:', e);
}

export interface RateLimitConfig {
    limit: number;      // リクエスト数上限
    windowMs: number;   // 時間枠（ミリ秒）
}

export interface RateLimitResult {
    success: boolean;
    limit: number;
    remaining: number;
    resetTime: number; // 既存コードとの互換性のため reset ではなく resetTime とする
}

// プリセット設定 (ミリ秒からUpstash用フォーマットへの変換は動的に行うか固定します)
export const RATE_LIMITS = {
    api: { limit: 100, windowMs: 60000 },        // 通常API: 100req/分
    auth: { limit: 10, windowMs: 60000 },        // 認証: 10req/分
    heavy: { limit: 20, windowMs: 60000 },       // 重い処理: 20req/分
} as const;

// Ratelimitのインスタンスキャッシュ用
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowMs: number): Ratelimit | null {
    if (!redis) return null;

    // Upstashは '10 s', '1 m' などの形式を要求するため、windowMsを秒換算
    const windowSec = Math.max(1, Math.floor(windowMs / 1000));
    const cacheKey = `${limit}:${windowSec}s`;

    if (!limiterCache.has(cacheKey)) {
        limiterCache.set(cacheKey, new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(limit, `${windowSec} s` as any),
            analytics: false,
        }));
    }
    return limiterCache.get(cacheKey)!;
}

/**
 * Rate Limitチェック（Upstash非同期版）
 * @param identifier IPアドレスやユーザーID
 * @param config 設定
 */
export async function checkRateLimit(
    identifier: string,
    config: RateLimitConfig = RATE_LIMITS.api
): Promise<RateLimitResult> {
    const limiter = getLimiter(config.limit, config.windowMs);

    // Redis環境変数が無い場合は常に成功(フェイルオープン)として扱う
    if (!limiter) {
        return {
            success: true,
            limit: config.limit,
            remaining: config.limit,
            resetTime: Date.now() + config.windowMs
        };
    }

    try {
        const { success, limit, remaining, reset } = await limiter.limit(identifier);
        return {
            success,
            limit,
            remaining,
            resetTime: reset, // 既存の resetTime プロパティ名にマッピング
        };
    } catch (error) {
        console.error('Rate limit error:', error);
        // DBエラー時は遮断せず通す（フェイルオープン方針）
        return {
            success: true,
            limit: config.limit,
            remaining: 1,
            resetTime: Date.now() + config.windowMs
        };
    }
}
