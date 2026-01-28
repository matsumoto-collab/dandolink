/**
 * シンプルなRate Limiter
 * サーバーレス環境では各インスタンスで独立動作
 * 本格運用時はUpstash等の外部ストレージ推奨
 */

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// 定期的に古いエントリを削除（メモリリーク防止）
const CLEANUP_INTERVAL = 60000; // 1分
let lastCleanup = Date.now();

function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    
    lastCleanup = now;
    for (const [key, entry] of rateLimitMap.entries()) {
        if (entry.resetTime < now) {
            rateLimitMap.delete(key);
        }
    }
}

export interface RateLimitConfig {
    limit: number;      // リクエスト数上限
    windowMs: number;   // 時間枠（ミリ秒）
}

export interface RateLimitResult {
    success: boolean;
    limit: number;
    remaining: number;
    resetTime: number;
}

/**
 * Rate Limitチェック
 * @param identifier IPアドレスやユーザーID
 * @param config 設定
 */
export function checkRateLimit(
    identifier: string,
    config: RateLimitConfig = { limit: 100, windowMs: 60000 }
): RateLimitResult {
    cleanup();
    
    const now = Date.now();
    const key = identifier;
    const entry = rateLimitMap.get(key);
    
    if (!entry || entry.resetTime < now) {
        // 新規または期限切れ
        rateLimitMap.set(key, { count: 1, resetTime: now + config.windowMs });
        return { success: true, limit: config.limit, remaining: config.limit - 1, resetTime: now + config.windowMs };
    }
    
    if (entry.count >= config.limit) {
        return { success: false, limit: config.limit, remaining: 0, resetTime: entry.resetTime };
    }
    
    entry.count++;
    return { success: true, limit: config.limit, remaining: config.limit - entry.count, resetTime: entry.resetTime };
}

// プリセット設定
export const RATE_LIMITS = {
    api: { limit: 100, windowMs: 60000 },        // 通常API: 100req/分
    auth: { limit: 10, windowMs: 60000 },        // 認証: 10req/分
    heavy: { limit: 20, windowMs: 60000 },       // 重い処理: 20req/分
} as const;
