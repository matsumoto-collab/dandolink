/**
 * 図面に置いた記号を数える（純粋関数・指示書 docs/指示書_道路申請_Phase2b_記号.md §5.3・設計書 §6.7）。
 *
 * - 数量の文（警察の「方法又は形態」に入れる）＝ countLabel ごとに数えて
 *   「カラーコーン 11個・コーンバー 10本（1.5m）・トラック 1台・誘導員 2人」（ashiba3d 旧版と同じ書き方）
 * - 凡例（図面の表題欄の上）＝ 記号ごとに 下絵・名前・数
 * - 印刷しないレイヤ（表示していない／印刷しない）の記号は数えない（PDF に出るものと合わせる）
 * - 記号の表に無い symbolId は数えない
 */
import type { DrawingEntity, DrawingLayer } from '@/types/roadPermitDrawing';
import type { RoadPermitSymbolDto, RoadPermitSymbolGeometry, RoadPermitSymbolMap } from '@/types/roadPermitSymbol';
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
        const next: SymbolCountRow = { key, countLabel: label, countUnit: sym.countUnit.trim(), countNote: note, count, symbolId: sym.id };
        byKey.set(key, next);
        rows.push(next);
    }
    return rows;
}

/** 数量の文（「カラーコーン 11個・コーンバー 10本（1.5m）」）。0 件なら '' */
export function symbolCountText(rows: readonly SymbolCountRow[]): string {
    return rows
        .filter((r) => r.count > 0)
        .map((r) => `${r.countLabel} ${r.count}${r.countUnit}${r.countNote ? `（${r.countNote}）` : ''}`)
        .join('・');
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
