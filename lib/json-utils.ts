/**
 * JSON フィールド処理ユーティリティ
 * 純粋関数のみ（テスト容易性のため分離）
 */

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
