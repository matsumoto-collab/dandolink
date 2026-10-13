/**
 * 記号（RoadPermitSymbol）の JSON の正規化と、取り込み時の名前の掃除・初期値（純粋関数。DB は読まない）。
 * サーバー（API）からも画面からも使う。
 *
 * - normalizeRoadPermitSymbolGeometry … DB の JSON → 型どおりの形（数でないものは落とす・数の並びは区切りにそろえる・上限まで）
 * - cleanJwwBlockName               … JWW のブロック名から「（CAD素材.com）」「@@SfigorgFlag@@4」を外す
 * - defaultBarPitchMm / defaultBarCountNote … コーンバーの初期値（指示書 §3.1・§4）
 */
import type { RoadPermitSymbolCategory, RoadPermitSymbolDto, RoadPermitSymbolGeometry } from '@/types/roadPermitSymbol';
import { ROAD_PERMIT_SYMBOL_CATEGORIES } from '@/types/roadPermitSymbol';

/** 1 つの記号が持てる 線・円・円弧・連続線の区間 の上限（API の入力チェックと正規化で同じ数を使う） */
export const ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES = 5000;
/** これを超える記号は保存の前に簡略化する（指示書 §3.3 の目安） */
export const ROAD_PERMIT_SYMBOL_SIMPLIFY_THRESHOLD = 2000;
/** 名前などの文字の上限 */
export const ROAD_PERMIT_SYMBOL_NAME_MAX = 100;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** 数の並びにそろえる（数でないものがあれば、その区切りごと落とす） */
function numbers(v: unknown, stride: number, maxGroups: number): number[] {
    if (!Array.isArray(v)) return [];
    const out: number[] = [];
    const groups = Math.floor(v.length / stride);
    for (let gi = 0; gi < groups && gi < maxGroups; gi++) {
        const group: number[] = [];
        let ok = true;
        for (let k = 0; k < stride; k++) {
            const n = v[gi * stride + k];
            if (typeof n !== 'number' || !Number.isFinite(n)) {
                ok = false;
                break;
            }
            group.push(n);
        }
        if (ok) out.push(...group);
    }
    return out;
}

/** DB の JSON（RoadPermitSymbol.geometry）→ 形。壊れていても落ちない（空の形になるだけ） */
export function normalizeRoadPermitSymbolGeometry(raw: unknown): RoadPermitSymbolGeometry {
    const o = obj(raw);
    const max = ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES;
    const lines = numbers(o.lines, 4, max);
    let used = lines.length / 4;
    const circles = numbers(o.circles, 3, Math.max(0, max - used));
    used += circles.length / 3;
    const arcs = numbers(o.arcs, 5, Math.max(0, max - used));
    used += arcs.length / 5;
    const polylines: number[][] = [];
    if (Array.isArray(o.polylines)) {
        for (const poly of o.polylines) {
            if (used >= max) break;
            const pts = numbers(poly, 2, Math.max(0, max - used) + 1);
            if (pts.length < 4) continue;
            polylines.push(pts);
            used += pts.length / 2 - 1;
        }
    }
    return { lines, circles, arcs, polylines };
}

export function normalizeRoadPermitSymbolCategory(v: unknown): RoadPermitSymbolCategory {
    return (ROAD_PERMIT_SYMBOL_CATEGORIES as readonly unknown[]).includes(v) ? (v as RoadPermitSymbolCategory) : 'other';
}

/**
 * JWW のブロック名を画面に出す名前にする。
 * 「（CAD素材.com）」「(CAD素材.com)」はどこにあっても外す（誘導員平面（CAD素材.com）5 → 誘導員平面5）。
 * 末尾の「@@SfigorgFlag@@4」のような印も外す。前後の空白を取る。空になれば元の名前のまま。
 */
export function cleanJwwBlockName(raw: string): string {
    const cleaned = raw
        .replace(/@@[A-Za-z]+@@\d*$/g, '')
        .replace(/[（(]\s*CAD素材\.com\s*[）)]/g, '')
        .trim();
    return cleaned === '' ? raw.trim() : cleaned.slice(0, ROAD_PERMIT_SYMBOL_NAME_MAX);
}

/** ブロック名が目印用（_Origin・_Small など）か。記号として出さない */
export function isMarkerBlockName(raw: string): boolean {
    return raw.startsWith('_');
}

/** コーンバーのコーンの間隔の初期値＝長さ − 幅（両端の輪の直径＝幅のため）。整数・最低 1 */
export function defaultBarPitchMm(lengthMm: number, widthMm: number): number {
    return Math.max(1, Math.round(lengthMm - widthMm));
}

/** コーンバーの数量の文の添え字の初期値（1500 → 「1.5m」・2000 → 「2.0m」） */
export function defaultBarCountNote(lengthMm: number): string {
    return `${(lengthMm / 1000).toFixed(1)}m`;
}

/** コーンバーとして使う記号か */
export function isConeBarSymbol(s: Pick<RoadPermitSymbolDto, 'barPitchMm'>): boolean {
    return s.barPitchMm != null && s.barPitchMm > 0;
}

/** 大きさの表記（長さ×幅・整数・3 桁区切り）。例 6,296×2,166 */
export function formatSymbolSize(s: Pick<RoadPermitSymbolDto, 'lengthMm' | 'widthMm'>): string {
    const f = (v: number) => Math.round(v).toLocaleString('ja-JP');
    return `${f(s.lengthMm)}×${f(s.widthMm)}`;
}

const CATEGORY_ORDER = new Map<RoadPermitSymbolCategory, number>(ROAD_PERMIT_SYMBOL_CATEGORIES.map((c, i) => [c, i]));

/** 分類の順 → 並び順 → 名前 で並べる（一覧・パレット・凡例で同じ順にする） */
export function sortRoadPermitSymbols<T extends Pick<RoadPermitSymbolDto, 'category' | 'sortOrder' | 'name'>>(list: readonly T[]): T[] {
    return [...list].sort((a, b) => {
        const ca = CATEGORY_ORDER.get(a.category) ?? 99;
        const cb = CATEGORY_ORDER.get(b.category) ?? 99;
        if (ca !== cb) return ca - cb;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name, 'ja');
    });
}

/** symbolId → 記号 の表を作る */
export function toSymbolMap(list: readonly RoadPermitSymbolDto[]): Map<string, RoadPermitSymbolDto> {
    return new Map(list.map((s) => [s.id, s]));
}
