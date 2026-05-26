/**
 * 検索文字列の正規化ヘルパー。
 *
 * NFKC 正規化で全角英数→半角、半角カナ→全角カナ、合字（㈱→株式会社）などを統一形に潰し、
 * 大文字小文字も無視する。これにより「Ｕ-tec」と「U-tec」が同一視されてヒットするようになる。
 */

export function normalizeForSearch(s: string | null | undefined): string {
    if (!s) return '';
    return s.normalize('NFKC').toLowerCase();
}

/**
 * target の中に query が含まれるか（全角/半角・大文字小文字を区別しない）。
 * query が空のときは true（フィルタなし）。
 */
export function matchesSearch(
    target: string | null | undefined,
    query: string | null | undefined
): boolean {
    const q = normalizeForSearch(query);
    if (!q) return true;
    return normalizeForSearch(target).includes(q);
}
