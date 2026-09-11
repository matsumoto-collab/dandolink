/**
 * CSV の読み取り（RFC 4180）。
 *
 * 過去データの CSV には `"P,spo24伊予店様 仮設工事"` のように引用符で囲まれてカンマを含む
 * 現場名がある。カンマで単純に分けると列がずれるので、引用符・引用符の二重化・改行に対応する。
 * 先頭の BOM（Excel が付ける）と、末尾の空行は読み飛ばす。
 */
export function parseCsv(text: string): string[][] {
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            // \r\n は 1 つの改行として扱う
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }
    // 最終行（改行で終わっていない場合）
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    // 空行（列が 1 つで中身が空）を捨てる
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** 1 行目を見出しとして、各行を「見出し → 値」の形にする。行番号（1 始まり・見出し行 = 1）も付ける */
export function csvToRecords(text: string): { headers: string[]; records: { line: number; values: Record<string, string> }[] } {
    const rows = parseCsv(text);
    if (rows.length === 0) return { headers: [], records: [] };
    const headers = rows[0].map((h) => h.trim());
    const records = rows.slice(1).map((r, i) => {
        const values: Record<string, string> = {};
        headers.forEach((h, j) => {
            values[h] = (r[j] ?? '').trim();
        });
        return { line: i + 2, values };
    });
    return { headers, records };
}
