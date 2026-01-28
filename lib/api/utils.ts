import { NextResponse, NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit, RateLimitConfig, RATE_LIMITS } from '@/lib/rate-limit';

// JSON処理関数を再エクスポート（後方互換性）
export { parseJsonField, stringifyJsonField, parseJsonFields } from '@/lib/json-utils';
export { RATE_LIMITS } from '@/lib/rate-limit';

/**
 * API共通ユーティリティ
 * 認証チェック、エラーレスポンス、JSON処理を統一
 */

// ============================================
// 認証・認可
// ============================================

/**
 * 認証済みセッションを取得（認証必須）
 * @returns セッションまたはエラーレスポンス
 */
export async function requireAuth() {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
        return {
            session: null,
            error: NextResponse.json(
                { error: '認証が必要です' },
                { status: 401 }
            ),
        };
    }

    return { session, error: null };
}

/**
 * 管理者権限を要求
 */
export async function requireAdmin() {
    const { session, error } = await requireAuth();

    if (error) return { session: null, error };

    if (session!.user.role !== 'admin') {
        return {
            session: null,
            error: NextResponse.json(
                { error: '管理者権限が必要です' },
                { status: 403 }
            ),
        };
    }

    return { session, error: null };
}

// ============================================
// エラーレスポンス
// ============================================

/**
 * 標準エラーレスポンスを生成
 */
export function errorResponse(
    message: string,
    status: 400 | 401 | 403 | 404 | 500 = 500
) {
    return NextResponse.json({ error: message }, { status });
}

/**
 * Not Found エラー
 */
export function notFoundResponse(resourceName: string) {
    return NextResponse.json(
        { error: `${resourceName}が見つかりません` },
        { status: 404 }
    );
}

/**
 * バリデーションエラー
 */
export function validationErrorResponse(message: string, details?: unknown) {
    return NextResponse.json(
        { error: message, details },
        { status: 400 }
    );
}

/**
 * サーバーエラー（コンソールにログも出力）
 */
export function serverErrorResponse(
    operation: string,
    error: unknown
) {
    console.error(`${operation} error:`, error);
    return NextResponse.json(
        { error: `${operation}に失敗しました` },
        { status: 500 }
    );
}

// JSON処理関数は @/lib/json-utils から再エクスポート済み

// ============================================
// レスポンスヘルパー
// ============================================

/**
 * 成功レスポンス（キャッシュヘッダー付き）
 */
export function successResponse<T>(
    data: T,
    options?: {
        cacheMaxAge?: number;
        staleWhileRevalidate?: number;
    }
) {
    const headers: Record<string, string> = {};

    if (options?.cacheMaxAge) {
        const stale = options.staleWhileRevalidate ?? 60;
        headers['Cache-Control'] = `private, max-age=${options.cacheMaxAge}, stale-while-revalidate=${stale}`;
    }

    return NextResponse.json(data, { headers });
}

/**
 * 削除成功レスポンス
 */
export function deleteSuccessResponse(resourceName: string) {
    return NextResponse.json({ message: `${resourceName}を削除しました` });
}

// ============================================
// Rate Limiting
// ============================================

/**
 * IPアドレスを取得
 */
function getClientIp(req: NextRequest): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('x-real-ip')
        || 'unknown';
}

/**
 * Rate Limitチェック（エラー時はレスポンスを返す）
 */
export function applyRateLimit(req: NextRequest, config: RateLimitConfig = RATE_LIMITS.api): NextResponse | null {
    const ip = getClientIp(req);
    const result = checkRateLimit(ip, config);

    if (!result.success) {
        return NextResponse.json(
            { error: 'リクエスト数が上限を超えました。しばらく待ってから再試行してください。' },
            {
                status: 429,
                headers: {
                    'X-RateLimit-Limit': result.limit.toString(),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': result.resetTime.toString(),
                    'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
                },
            }
        );
    }

    return null;
}
