/**
 * 検索ヒットハイライト用ユーティリティ。
 *
 * 設計方針:
 * - 一致判定は utils/searchNormalize.ts の NFKC 正規化と整合させる
 *   （Ｕ-tec ↔ U-tec、㈱ ↔ 株式会社、大文字小文字、全角半角を吸収）。
 * - JSX を返すが、ファイルは `.ts` 拡張子のままにするため React.createElement を使う。
 * - ハイライトは React 要素として組み立てるため、テキスト内容は React が自動でエスケープする。
 *   dangerouslySetInnerHTML は使わない（XSS リスクなし）。
 * - 隣接・重複マッチはマージして 1 つの <mark> に統合する。
 * - 1 文字が複数文字に展開される NFKC 変換（例：㈱→株式会社）にも対応。
 *   元テキスト側の対応文字を丸ごとハイライトする保守的な実装。
 */

import React from 'react';
import { normalizeForSearch } from '@/utils/searchNormalize';

interface CharMapEntry {
    /** 正規化文字列における開始位置（包括的） */
    normStart: number;
    /** 正規化文字列における終端位置（排他的） */
    normEnd: number;
    /** 元テキストにおける開始位置（包括的） */
    origStart: number;
    /** 元テキストにおける終端位置（排他的） */
    origEnd: number;
}

interface BuildCharMapResult {
    normalized: string;
    map: CharMapEntry[];
}

function buildCharMap(text: string): BuildCharMapResult {
    let normalized = '';
    const map: CharMapEntry[] = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const normCh = ch.normalize('NFKC').toLowerCase();
        map.push({
            normStart: normalized.length,
            normEnd: normalized.length + normCh.length,
            origStart: i,
            origEnd: i + 1,
        });
        normalized += normCh;
    }
    return { normalized, map };
}

interface OrigRange {
    start: number;
    end: number;
}

function findOrigRange(map: CharMapEntry[], normStart: number, normEnd: number): OrigRange | null {
    let origStart = -1;
    let origEnd = -1;
    for (const entry of map) {
        if (origStart === -1 && entry.normEnd > normStart) {
            origStart = entry.origStart;
        }
        if (entry.normStart < normEnd) {
            origEnd = entry.origEnd;
        } else {
            break;
        }
    }
    if (origStart === -1 || origEnd === -1 || origEnd <= origStart) return null;
    return { start: origStart, end: origEnd };
}

function mergeOverlaps(ranges: OrigRange[]): OrigRange[] {
    if (ranges.length === 0) return ranges;
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: OrigRange[] = [];
    for (const r of sorted) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end) {
            last.end = Math.max(last.end, r.end);
        } else {
            merged.push({ ...r });
        }
    }
    return merged;
}

/** ハイライト用 <mark> のデフォルト Tailwind クラス（黄色マーカー風）。 */
export const DEFAULT_HIGHLIGHT_CLASS = 'bg-yellow-200 text-slate-900 rounded px-0.5';

/**
 * 検索クエリに一致する箇所を `<mark>` で囲んだ React ノードを返す。
 * クエリが空 / マッチなしのときは元テキストをそのまま返す（null/undefined 入力は null）。
 *
 * @example
 *   highlightText('Ｕ-tec株式会社', 'u-tec') // → ['', <mark>Ｕ-tec</mark>, '株式会社']
 */
export function highlightText(
    text: string | null | undefined,
    query: string | null | undefined,
    className: string = DEFAULT_HIGHLIGHT_CLASS,
): React.ReactNode {
    if (text == null) return null;
    if (text === '') return text;

    const q = normalizeForSearch(query);
    if (!q) return text;

    const { normalized, map } = buildCharMap(text);
    if (!normalized.includes(q)) return text;

    const ranges: OrigRange[] = [];
    let pos = 0;
    while (pos + q.length <= normalized.length) {
        const found = normalized.indexOf(q, pos);
        if (found === -1) break;
        const range = findOrigRange(map, found, found + q.length);
        if (range) ranges.push(range);
        pos = found + Math.max(q.length, 1);
    }

    if (ranges.length === 0) return text;

    const merged = mergeOverlaps(ranges);
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const r of merged) {
        if (cursor < r.start) parts.push(text.slice(cursor, r.start));
        parts.push(
            React.createElement(
                'mark',
                { key: `m-${r.start}-${r.end}`, className },
                text.slice(r.start, r.end),
            ),
        );
        cursor = r.end;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));

    return React.createElement(React.Fragment, null, ...parts);
}
