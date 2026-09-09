/**
 * CSV の組み立て・ダウンロード（クライアント側の共通処理）。
 *
 * Excel での集計を前提にするため:
 * - 先頭に BOM を付ける（付けないと Excel が Shift_JIS と誤認して日本語が化ける）
 * - 改行は CRLF（Excel の期待する形）
 *
 * ※ API 側（app/api/attendance/export など）にも同等のエスケープ実装があるが、
 *   サーバー側は NextResponse を直接返す作りなのでここでは統合しない。
 */

/** CSV の1セルをエスケープする（`,` `"` 改行 を含むときだけ引用符で囲む）。 */
export function escapeCsvCell(v: string): string {
    if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
        return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
}

/** 行データを CSV 文字列にする（BOM + CRLF 区切り）。 */
export function toCsvString(rows: string[][]): string {
    const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    return '\uFEFF' + body;
}

/** CSV 文字列をファイルとしてダウンロードさせる（ブラウザ専用）。 */
export function downloadCsv(filename: string, csv: string): void {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
