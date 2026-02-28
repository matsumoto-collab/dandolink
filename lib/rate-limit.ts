import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * 分散Rate Limiter (Upstash Redis利用)
 * Redis未設定時はインメモリフォールバックで保護を維持します。
 */

// Redisインスタンスの初期化
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

// インメモリフォールバック（Redis未設定時・Redis障害時に使用）
// サーバーレス環境ではインスタンス単位の保護となるが、無制限よりは安全
interface MemoryRecord { count: number; resetAt: number }
const memoryStore = new Map<string, MemoryRecord>();

// 古いエントリの定期クリーンアップ（メモリリーク防止）
function cleanupMemoryStore() {
    const now = Date.now();
    for (const [key, record] of memoryStore.entries()) {
        if (record.resetAt <= now) memoryStore.delete(key);
    }
}

function checkMemoryRateLimit(identifier: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();
    const key = `${identifier}:${config.limit}:${config.windowMs}`;
    const record = memoryStore.get(key);

    if (!record || record.resetAt <= now) {
        memoryStore.set(key, { count: 1, resetAt: now + config.windowMs });
        if (memoryStore.size > 10000) cleanupMemoryStore();
        return { success: true, limit: config.limit, remaining: config.limit - 1, resetTime: now + config.windowMs };
    }

    record.count++;
    const remaining = Math.max(0, config.limit - record.count);
    return {
        success: record.count <= config.limit,
        limit: config.limit,
        remaining,
        resetTime: record.resetAt,
    };
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
    api: { limit: 300, windowMs: 60000 },        // 通常API: 300req/分
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

    // Redis未設定時はインメモリフォールバックで保護
    if (!limiter) {
        return checkMemoryRateLimit(identifier, config);
    }

    try {
        const { success, limit, remaining, reset } = await limiter.limit(identifier);
        return {
            success,
            limit,
            remaining,
            resetTime: reset,
        };
    } catch (error) {
        console.error('Rate limit error (Redis):', (error instanceof Error) ? error.message : String(error));
        // Redis障害時はインメモリフォールバックで保護を維持
        return checkMemoryRateLimit(identifier, config);
    }
}
