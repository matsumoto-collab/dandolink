import { NextResponse, NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit, RateLimitConfig, RATE_LIMITS } from '@/lib/rate-limit';
import { Prisma } from '@prisma/client';

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
 * 競合エラーレスポンス（楽観的ロック用）
 * 他のユーザーによる更新が先に行われた場合に返却
 */
export function conflictResponse<T>(message: string, latestData: T) {
    return NextResponse.json(
        {
            error: message,
            code: 'CONFLICT',
            latestData,
        },
        { status: 409 }
    );
}

/**
 * Prismaエラーの種類を判定
 */
function getPrismaErrorInfo(error: unknown): { status: number; message: string; code?: string } | null {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
            case 'P2002': // Unique constraint violation
                return { status: 400, message: '同じデータが既に存在します', code: error.code };
            case 'P2003': // Foreign key constraint violation
                return { status: 400, message: '関連するデータが存在しないか、削除できません', code: error.code };
            case 'P2025': // Record not found
                return { status: 404, message: '対象のデータが見つかりません', code: error.code };
            case 'P2014': // Required relation violation
                return { status: 400, message: '必要な関連データが不足しています', code: error.code };
            default:
                return { status: 500, message: 'データベースエラーが発生しました', code: error.code };
        }
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
        return { status: 400, message: '入力データが不正です', code: 'VALIDATION_ERROR' };
    }
    return null;
}

/**
 * エラー詳細をログ用に構造化
 */
function formatErrorForLog(operation: string, error: unknown): Record<string, unknown> {
    const timestamp = new Date().toISOString();
    const base = { timestamp, operation };

    if (error instanceof Error) {
        return {
            ...base,
            name: error.name,
            message: error.message,
            stack: error.stack,
            // Prisma特有のプロパティ
            ...(error instanceof Prisma.PrismaClientKnownRequestError && {
                code: error.code,
                meta: error.meta,
            }),
        };
    }

    return { ...base, error: String(error) };
}

/**
 * サーバーエラー（詳細なログ出力 + Prismaエラー区別）
 */
export function serverErrorResponse(
    operation: string,
    error: unknown
) {
    // 構造化されたエラーログを出力
    const errorLog = formatErrorForLog(operation, error);
    console.error('[API Error]', JSON.stringify(errorLog, null, 2));

    // Prismaエラーの場合は適切なステータスとメッセージを返す
    const prismaError = getPrismaErrorInfo(error);
    if (prismaError) {
        return NextResponse.json(
            {
                error: `${operation}に失敗しました: ${prismaError.message}`,
                code: prismaError.code,
            },
            { status: prismaError.status }
        );
    }

    // その他のエラーは500を返す
    return NextResponse.json(
        { error: `${operation}に失敗しました` },
        { status: 500 }
    );
}

// JSON処理関数は @/lib/json-utils から再エクスポート済み

// ============================================
// バリデーションヘルパー
// ============================================

/**
 * 文字列フィールドのバリデーション（trim + 長さチェック）
 */
export function validateStringField(value: unknown, fieldName: string, maxLength = 200): string | NextResponse {
    if (!value || typeof value !== 'string' || !value.trim()) {
        return validationErrorResponse(`${fieldName}は必須です`);
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
        return validationErrorResponse(`${fieldName}は${maxLength}文字以内で入力してください`);
    }
    return trimmed;
}

/**
 * 日付文字列のバリデーション
 */
export function validateDateString(value: unknown, fieldName: string): Date | NextResponse {
    if (!value || typeof value !== 'string') {
        return validationErrorResponse(`${fieldName}は必須です`);
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        return validationErrorResponse(`${fieldName}の日付形式が不正です`);
    }
    return date;
}

/**
 * 16進カラーコードのバリデーション
 */
export function validateHexColor(value: unknown): string {
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
        return value;
    }
    return '#a8c8e8'; // デフォルト色
}

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
