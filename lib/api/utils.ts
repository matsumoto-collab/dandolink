import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

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

// ============================================
// JSON フィールド処理
// ============================================

/**
 * JSON文字列をパースする（null/undefined対応）
 */
export function parseJsonField<T>(value: string | null | undefined, defaultValue: T): T {
    if (!value) return defaultValue;
    try {
        return JSON.parse(value) as T;
    } catch {
        return defaultValue;
    }
}

/**
 * 値をJSON文字列に変換（null/undefined対応）
 */
export function stringifyJsonField<T>(value: T | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return JSON.stringify(value);
}

/**
 * Prismaレコードの複数JSONフィールドをパース
 * @param record Prismaから取得したレコード
 * @param fields パースするフィールド名と型のマップ
 */
export function parseJsonFields<T extends Record<string, unknown>>(
    record: T,
    fields: { [K in keyof T]?: unknown }
): T {
    const result = { ...record };
    for (const [key, defaultValue] of Object.entries(fields)) {
        const value = record[key as keyof T];
        if (typeof value === 'string') {
            (result as Record<string, unknown>)[key] = parseJsonField(value, defaultValue);
        }
    }
    return result;
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
