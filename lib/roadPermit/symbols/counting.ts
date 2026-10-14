/**
 * 図面に置いた記号を数える（純粋関数・指示書 docs/指示書_道路申請_Phase2b_記号.md §5.3・設計書 §6.7）。
 *
 * - 「方法又は形態」（警察）に入れる文＝ 置いた記号の countLabel をパレットの並び順で並べ、分類ごとの言葉を付ける。
 *   **数は書かない**（許可が出た書類と同じ。kei 決定 2026-10-14・docs/指示書_道路申請_許可書を見ての修正.md §2）
 *   例「パイロン・コーンバー設置」「カラーコーン・コーンバー設置・トラック駐車・誘導員配置」
 * - 数は 凡例（図面の表題欄の上）に出す＝ 記号ごとに 下絵・名前・数
 * - 印刷しないレイヤ（表示していない／印刷しない）の記号は数えない（PDF に出るものと合わせる）
 * - 記号の表に無い symbolId は数えない
 */
import type { DrawingEntity, DrawingLayer } from '@/types/roadPermitDrawing';
import type { RoadPermitSymbolCategory, RoadPermitSymbolDto, RoadPermitSymbolGeometry, RoadPermitSymbolMap } from '@/types/roadPermitSymbol';
import { sortRoadPermitSymbols } from '@/lib/roadPermit/symbols/normalize';

export interface SymbolCountRow {
    /** まとめのかぎ（countLabel＋countNote） */
    key: string;
    countLabel: string;
    countUnit: string;
    countNote: string;
    count: number;
    /** まとめた中で最初（並び順で先）の記号 */
    symbolId: string;
    /** まとめた中で最初の記号の分類（「方法又は形態」の末尾の言葉を決める） */
    category: RoadPermitSymbolCategory;
}

export interface LegendRow {
    symbolId: string;
    name: string;
    count: number;
    /** 数の単位（空なら「個」） */
    unit: string;
    geometry: RoadPermitSymbolGeometry;
}

/** 印刷するレイヤか（レイヤが見つからない古いデータは印刷する＝DrawingPage と同じ） */
function printableLayerSet(layers: readonly DrawingLayer[] | undefined): (id: number) => boolean {
    if (!layers) return () => true;
    return (id: number) => {
        const l = layers.find((x) => x.id === id);
        return !l || (l.visible && l.printable);
    };
}

/** 印刷するレイヤにある記号を、記号ごとに数える（表に無いものは除く）。並びは sortRoadPermitSymbols の順 */
function countBySymbol(
    entities: readonly DrawingEntity[],
    symbols: RoadPermitSymbolMap,
    layers?: readonly DrawingLayer[],
): { sym: RoadPermitSymbolDto; count: number }[] {
    const printable = printableLayerSet(layers);
    const counts = new Map<string, number>();
    for (const e of entities) {
        if (e.kind !== 'symbol' || !printable(e.layer)) continue;
        if (!symbols.has(e.symbolId)) continue;
        counts.set(e.symbolId, (counts.get(e.symbolId) ?? 0) + 1);
    }
    const used = sortRoadPermitSymbols(Array.from(counts.keys()).map((id) => symbols.get(id)!));
    return used.map((sym) => ({ sym, count: counts.get(sym.id) ?? 0 }));
}

/**
 * 数量の文のための数え方。countLabel が空の記号は数えない。countLabel＋countNote が同じものはまとめる。
 * layers を渡すと、印刷しないレイヤの記号を除く
 */
export function countSymbols(
    entities: readonly DrawingEntity[],
    symbols: RoadPermitSymbolMap,
    layers?: readonly DrawingLayer[],
): SymbolCountRow[] {
    const rows: SymbolCountRow[] = [];
    const byKey = new Map<string, SymbolCountRow>();
    for (const { sym, count } of countBySymbol(entities, symbols, layers)) {
        const label = sym.countLabel.trim();
        if (!label) continue;
        const note = sym.countNote.trim();
        const key = `${label}\u0000${note}`;
        const row = byKey.get(key);
        if (row) {
            row.count += count;
            continue;
        }
        const next: SymbolCountRow = {
            key,
            countLabel: label,
            countUnit: sym.countUnit.trim(),
            countNote: note,
            count,
            symbolId: sym.id,
            category: sym.category,
        };
        byKey.set(key, next);
        rows.push(next);
    }
    return rows;
}

/** 「方法又は形態」の末尾の言葉（分類ごと）: コーン類・バリケード・路面標示・その他＝設置／車両・クレーン＝駐車／人＝配置 */
export const SYMBOL_METHOD_SUFFIX: Record<RoadPermitSymbolCategory, string> = {
    cone: '設置',
    barricade: '設置',
    road: '設置',
    other: '設置',
    vehicle: '駐車',
    crane: '駐車',
    person: '配置',
};

/**
 * 「方法又は形態」に入れる文（数を書かない）。
 * countLabel を並び順のまま重ならないように並べ（countNote が違っても同じ名前は 1 つ）、分類ごとの言葉を付ける。
 * 同じ言葉が続くものは「・」でつないで最後にだけ付ける。0 件なら ''
 * 例: [カラーコーン, コーンバー, トラック, 誘導員] → 「カラーコーン・コーンバー設置・トラック駐車・誘導員配置」
 */
export function symbolMethodText(rows: readonly SymbolCountRow[]): string {
    const seen = new Set<string>();
    const items: { label: string; suffix: string }[] = [];
    for (const r of rows) {
        if (r.count <= 0 || seen.has(r.countLabel)) continue;
        seen.add(r.countLabel);
        items.push({ label: r.countLabel, suffix: SYMBOL_METHOD_SUFFIX[r.category] ?? '設置' });
    }
    const parts: string[] = [];
    let group: string[] = [];
    let groupSuffix = '';
    for (const it of items) {
        if (group.length > 0 && it.suffix !== groupSuffix) {
            parts.push(group.join('・') + groupSuffix);
            group = [];
        }
        group.push(it.label);
        groupSuffix = it.suffix;
    }
    if (group.length > 0) parts.push(group.join('・') + groupSuffix);
    return parts.join('・');
}

/** 凡例の行（記号ごと。countLabel が空でも名前で出す）。layers を渡すと印刷しないレイヤの記号を除く */
export function legendRows(entities: readonly DrawingEntity[], symbols: RoadPermitSymbolMap, layers?: readonly DrawingLayer[]): LegendRow[] {
    return countBySymbol(entities, symbols, layers).map(({ sym, count }) => ({
        symbolId: sym.id,
        name: sym.name,
        count,
        unit: sym.countUnit.trim() || '個',
        geometry: sym.geometry,
    }));
}

/** 凡例に出す行の上限（超えたら最後の行を「ほか n 種」にする） */
export const LEGEND_MAX_ROWS = 12;

/** 凡例に出す行（上限を超えたら先頭 11 行＋「ほか n 種」の数） */
export function legendVisibleRows(rows: readonly LegendRow[], max = LEGEND_MAX_ROWS): { rows: LegendRow[]; more: number } {
    if (rows.length <= max) return { rows: [...rows], more: 0 };
    const keep = Math.max(0, max - 1);
    return { rows: rows.slice(0, keep), more: rows.length - keep };
}

/** 凡例の大きさ（用紙上 mm）。PDF（DrawingPage）と画面の目安（DrawingCanvas）で同じ値を使う */
export interface LegendLayout {
    /** 見出し「凡　例」の行の高さ */
    headerMm: number;
    /** 1 行の高さ */
    rowMm: number;
    /** 下絵の枠（正方形の 1 辺） */
    thumbMm: number;
    /** 文字の大きさ */
    fontMm: number;
    /** 全体の高さ */
    heightMm: number;
}

/** 凡例の幅（表題欄と同じ 140mm） */
export const LEGEND_WIDTH_MM = 140;

/** 行の数（「ほか n 種」の行を含む）→ 凡例の大きさ。行が多いほど小さくする */
export function legendLayout(lineCount: number): LegendLayout {
    const n = Math.max(0, lineCount);
    const rowMm = n <= 6 ? 10 : n <= 9 ? 8.5 : 7;
    const thumbMm = Math.min(8, rowMm - 1.5);
    const fontMm = n <= 6 ? 2.8 : n <= 9 ? 2.5 : 2.2;
    const headerMm = 6;
    return { headerMm, rowMm, thumbMm, fontMm, heightMm: headerMm + rowMm * n };
}
