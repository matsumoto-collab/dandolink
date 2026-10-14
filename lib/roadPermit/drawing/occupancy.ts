/**
 * 占用範囲の面積と式（純粋関数）。
 * 指示書 docs/指示書_道路申請_許可書を見ての修正.md §1・設計書 §2.5（許可が出た書類の書き方に合わせる）。
 *
 * 書き方の決まり
 * - 長さは 図面の座標（mm）から出した値を 0.1mm に丸め、m にして末尾の 0 を付けない（575 → 0.575・7,700 → 7.7・13,640.8 → 13.6408）
 * - 面積は 式に出した数どうしを掛けた「ちょうどの値」（丸めない・末尾の 0 なし）。浮動小数の誤差（5.807499999…）が出ないよう、
 *   0.1mm を 1 とした整数で計算してから小数の文字にする
 * - 長方形（回転していてもよい）→「0.575×10.1＝5.8075㎡」（出幅×延長）
 * - 直角三角形 →「0.508×0.7568÷2＝0.1922272㎡」（直角をはさむ 2 辺・短い×長い）
 * - 直角でない三角形 →「高さ×底辺÷2＝面積㎡」（底辺＝いちばん長い辺・高さは 0.1mm に丸めた値・面積は式の数から出す）
 * - その他 →「7.716㎡（出幅 ○・延長 ○）」（頂点を 0.1mm に丸めて面積を整数で出す。延長＝いちばん長い辺・出幅＝面積÷延長）
 * - 「約○㎡」は ちょうどの値を切り上げ（申請書の approxAreaOf と同じ考え方。2.0004 → 3）
 *
 * 図面の文字
 * - 1 つのとき: 「路線名（あれば）　式　約○㎡」
 * - 2 つ以上のとき: 範囲ごとに ①②… の印を付け、まとまり（「申請物件」＋ ①② の式 ＋ 合計と約○㎡）を 1 つ出す
 * - 文字の位置は OccupancyEntity.labelAt／RoadPermitDrawing.occupancyNoteAt（null なら自動＝重心／範囲の左下の下）
 */
import type { DrawingPoint, OccupancyEntity, RoadPermitDrawing } from '@/types/roadPermitDrawing';
import type { RoadPermitOccupancy } from '@/types/roadPermit';
import { distance } from '@/lib/roadPermit/drawing/geometry';

export type OccupancyShapeKind = 'rect' | 'triangle' | 'other';

/** 長さの単位: 0.1mm を 1 とした整数（u）。m にするときの小数の桁 */
const LEN_SCALE = 4;
/** 面積の単位: 1e-9 ㎡ を 1 とした整数（u×u＝0.01mm²＝1e-8 ㎡ なので 10 倍。÷2 の式でも整数のまま） */
const AREA_SCALE = 9;
const AREA_ONE = 1_000_000_000;

export interface OccupancyMeasure {
    kind: OccupancyShapeKind;
    /** 面積（1e-9 ㎡ を 1 とした整数。足し算・切り上げに使う） */
    areaN: number;
    /** 面積の文字（ちょうどの値・末尾の 0 なし。例 '5.8075'） */
    areaText: string;
    /** 面積（数・areaText を数にしたもの。目安や並べ替えに） */
    areaM2: number;
    /** 延長（m）。三角形は底辺・その他はいちばん長い辺 */
    lengthM: number;
    /** 出幅（m）。三角形は高さ（直角三角形は短い辺）・その他は面積÷延長 */
    widthM: number;
    /** 延長・出幅の文字（0.1mm に丸めた値・末尾の 0 なし。例 '10.1'・'0.575'） */
    lengthText: string;
    widthText: string;
    /** 式（例「0.575×10.1＝5.8075㎡」） */
    expression: string;
}

/** 申請書に入れるときに親へ渡す 1 つ分（路線名つき） */
export interface OccupancyApplyItem extends Pick<OccupancyMeasure, 'areaN' | 'areaText' | 'expression'> {
    routeName: string;
}

/** 合計（2 つ以上のとき）。1 つでも同じ形で出す */
export interface OccupancyTotal {
    areaN: number;
    areaText: string;
    /** 約○㎡（切り上げ） */
    approx: number;
}

/** 図面の中の文字の大きさ（用紙上 mm）と行の高さ（文字の大きさの倍率）。画面と PDF で同じ値を使う */
export const OCCUPANCY_TEXT_PAPER_MM = 3;
export const OCCUPANCY_LINE_HEIGHT = 1.4;

/** 直角とみなす誤差（度） */
const RIGHT_ANGLE_TOL_DEG = 0.5;
/** 向かい合う辺が「等しい」とみなす誤差（長さの割合と、最低 1mm） */
const EQUAL_LEN_RATIO = 1e-3;

// ---------------------------------------------------------------------------
// 整数の計算と小数の文字
// ---------------------------------------------------------------------------

/** mm → 0.1mm を 1 とした整数 */
const toU = (mm: number) => Math.round(mm * 10);

/**
 * 整数 n を「小数点以下 scale 桁」の小数の文字にする（末尾の 0 と小数点は付けない）。
 * 例 decimalText(5750, 4) → '0.575'、decimalText(5807500000, 9) → '5.8075'、decimalText(0, 9) → '0'
 */
export function decimalText(n: number, scale: number): string {
    const v = Math.round(Math.abs(n));
    const s = String(v).padStart(scale + 1, '0');
    const intPart = s.slice(0, s.length - scale);
    const frac = s.slice(s.length - scale).replace(/0+$/, '');
    const body = frac ? `${intPart}.${frac}` : intPart;
    return n < 0 && v !== 0 ? `-${body}` : body;
}

const lenText = (u: number) => decimalText(u, LEN_SCALE);
const areaTextOf = (n: number) => decimalText(n, AREA_SCALE);
const uToM = (u: number) => u / 10 ** LEN_SCALE;

/** 「約○㎡」: ちょうどの値（1e-9 ㎡ の整数）を切り上げた整数 */
export function occupancyApprox(areaN: number): number {
    if (!(areaN > 0)) return 0;
    return Math.floor((areaN + AREA_ONE - 1) / AREA_ONE);
}

// ---------------------------------------------------------------------------
// 形の判定
// ---------------------------------------------------------------------------

/** 閉じる点（最初と同じ点）が最後に重なっていたら外す */
function openRing(points: readonly DrawingPoint[]): DrawingPoint[] {
    const pts = [...points];
    if (pts.length >= 4 && distance(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
    return pts;
}

function edgeLengths(pts: readonly DrawingPoint[]): number[] {
    return pts.map((p, i) => distance(p, pts[(i + 1) % pts.length]));
}

/** 頂点 i の内角が直角か（±0.5 度） */
function isRightAngleAt(pts: readonly DrawingPoint[], i: number): boolean {
    const n = pts.length;
    const p = pts[i];
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const v1 = { x: a.x - p.x, y: a.y - p.y };
    const v2 = { x: b.x - p.x, y: b.y - p.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-9 || l2 < 1e-9) return false;
    const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    return Math.abs(deg - 90) <= RIGHT_ANGLE_TOL_DEG;
}

function nearlyEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= Math.max(1, Math.max(a, b) * EQUAL_LEN_RATIO);
}

/** 長方形か（4 点・向かい合う辺が等しく・4 つの角が直角。回転していてもよい） */
export function isRectangle(points: readonly DrawingPoint[]): boolean {
    const pts = openRing(points);
    if (pts.length !== 4) return false;
    const L = edgeLengths(pts);
    if (L.some((l) => l < 1e-6)) return false;
    if (!nearlyEqual(L[0], L[2]) || !nearlyEqual(L[1], L[3])) return false;
    return [0, 1, 2, 3].every((i) => isRightAngleAt(pts, i));
}

/** 多角形の 2 倍の面積（頂点を 0.1mm に丸めた整数で。単位 0.01mm²） */
function doubleAreaU(pts: readonly DrawingPoint[]): number {
    const q = pts.map((p) => ({ x: toU(p.x), y: toU(p.y) }));
    let s = 0;
    for (let i = 0; i < q.length; i++) {
        const a = q[i];
        const b = q[(i + 1) % q.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s);
}

const ZERO_MEASURE: OccupancyMeasure = {
    kind: 'other',
    areaN: 0,
    areaText: '0',
    areaM2: 0,
    lengthM: 0,
    widthM: 0,
    lengthText: '0',
    widthText: '0',
    expression: '0㎡',
};

function buildMeasure(
    kind: OccupancyShapeKind,
    areaN: number,
    lengthU: number,
    widthU: number,
    expression: (a: string, l: string, w: string) => string,
): OccupancyMeasure {
    const a = areaTextOf(areaN);
    const l = lenText(lengthU);
    const w = lenText(widthU);
    return {
        kind,
        areaN,
        areaText: a,
        areaM2: Number(a),
        lengthM: uToM(lengthU),
        widthM: uToM(widthU),
        lengthText: l,
        widthText: w,
        expression: expression(a, l, w),
    };
}

/** 占用範囲の面積・延長・出幅・式（points は実寸 mm） */
export function occupancyMeasure(points: readonly DrawingPoint[]): OccupancyMeasure {
    const pts = openRing(points);
    if (pts.length < 3) return ZERO_MEASURE;
    const area2 = doubleAreaU(pts);
    if (area2 <= 0) return ZERO_MEASURE;
    const L = edgeLengths(pts);
    const longest = Math.max(...L);

    if (isRectangle(pts)) {
        const lengthU = toU(Math.max(L[0], L[1]));
        const widthU = toU(Math.min(L[0], L[1]));
        // 出幅×延長（u×u＝0.01mm²＝1e-8 ㎡ → ×10 で 1e-9 ㎡）
        return buildMeasure('rect', widthU * lengthU * 10, lengthU, widthU, (a, l, w) => `${w}×${l}＝${a}㎡`);
    }
    if (pts.length === 3) {
        const right = [0, 1, 2].find((i) => isRightAngleAt(pts, i));
        if (right !== undefined) {
            // 直角をはさむ 2 辺（頂点 i に接する辺＝ L[i-1] と L[i]）。短い×長い÷2（u×u÷2 ＝ ×5 で 1e-9 ㎡）
            const legA = toU(L[(right + 2) % 3]);
            const legB = toU(L[right]);
            const shortU = Math.min(legA, legB);
            const longU = Math.max(legA, legB);
            return buildMeasure('triangle', shortU * longU * 5, longU, shortU, (a, l, w) => `${w}×${l}÷2＝${a}㎡`);
        }
        // 直角でない: 高さ×底辺÷2（底辺＝いちばん長い辺。高さは 0.1mm に丸め、面積は式の数から）
        const baseU = toU(longest);
        // area2（0.01mm²）÷100 ＝ 2×面積（mm²）→ ÷底辺（mm）＝ 高さ（mm）
        const heightU = toU(area2 / 100 / longest);
        return buildMeasure('triangle', heightU * baseU * 5, baseU, heightU, (a, l, w) => `${w}×${l}÷2＝${a}㎡`);
    }
    // その他: 面積は頂点を丸めた整数から（area2 は 0.01mm² の 2 倍 → ×5 で 1e-9 ㎡）。出幅＝面積÷延長
    const lengthU = toU(longest);
    const widthU = toU(area2 / 100 / 2 / longest);
    return buildMeasure('other', area2 * 5, lengthU, widthU, (a, l, w) => `${a}㎡（出幅 ${w}・延長 ${l}）`);
}

// ---------------------------------------------------------------------------
// 図面の文字
// ---------------------------------------------------------------------------

const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** 範囲に付ける印（0 始まり → ①②…⑳。それ以降は (21)…） */
export function occupancyMark(index: number): string {
    return index >= 0 && index < MARKS.length ? MARKS[index] : `(${index + 1})`;
}

/** 文字を置く位置の自動（多角形の重心。つぶれた形は点の平均） */
export function occupancyLabelPoint(points: readonly DrawingPoint[]): DrawingPoint {
    const pts = openRing(points);
    if (pts.length === 0) return { x: 0, y: 0 };
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        const c = p.x * q.y - q.x * p.y;
        a += c;
        cx += (p.x + q.x) * c;
        cy += (p.y + q.y) * c;
    }
    if (Math.abs(a) < 1e-9) {
        return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** 範囲ごとの文字の位置（動かしてあればその位置・無ければ重心） */
export function occupancyLabelAt(e: Pick<OccupancyEntity, 'points' | 'labelAt'>): DrawingPoint {
    return e.labelAt ?? occupancyLabelPoint(e.points);
}

/** 1 つのときの文字:「路線名（あれば）　式　約○㎡」（例「市道 新屋敷線　0.81×11.1＝8.991㎡　約9㎡」） */
export function occupancyLabel(e: Pick<OccupancyEntity, 'points' | 'routeName'>): string {
    const m = occupancyMeasure(e.points);
    const route = e.routeName.trim();
    const body = `${m.expression}　約${occupancyApprox(m.areaN)}㎡`;
    return route ? `${route}　${body}` : body;
}

/** 範囲に付ける文字。2 つ以上なら印（①②…）・1 つなら式の文字 */
export function occupancyEntityLabel(e: Pick<OccupancyEntity, 'points' | 'routeName'>, index: number, count: number): string {
    return count >= 2 ? occupancyMark(index) : occupancyLabel(e);
}

/**
 * 2 つ以上のときのまとまり（1 行ずつ）。1 つ以下なら []。
 *   申請物件
 *   ①　路線名（あれば）　0.508×0.7568÷2＝0.1922272㎡
 *   ②　0.3647×13.6408÷2＝2.48739988㎡
 *   0.1922272＋2.48739988＝2.67962708　約3㎡
 */
export function occupancyNoteLines(entities: readonly Pick<OccupancyEntity, 'points' | 'routeName'>[]): string[] {
    if (entities.length < 2) return [];
    const items = occupancyApplyItems(entities);
    const total = occupancyTotal(items);
    return [
        '申請物件',
        ...items.map((m, i) => `${occupancyMark(i)}　${m.routeName ? `${m.routeName}　` : ''}${m.expression}`),
        `${items.map((m) => m.areaText).join('＋')}＝${total.areaText}　約${total.approx}㎡`,
    ];
}

/**
 * まとまりの位置（左上の基準点・実寸 mm）。動かしてあればその位置・無ければ 範囲全体の左下から 1 行ぶん下。
 * 用紙上の 1 行の高さを実寸にするため drawing の縮尺を使う
 */
export function occupancyNoteAt(
    drawing: Pick<RoadPermitDrawing, 'occupancyNoteAt' | 'scale'>,
    entities: readonly Pick<OccupancyEntity, 'points'>[],
): DrawingPoint {
    if (drawing.occupancyNoteAt) return drawing.occupancyNoteAt;
    let minX = Infinity;
    let minY = Infinity;
    for (const e of entities) {
        for (const p of e.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
        }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 0, y: 0 };
    // 1 行ぶん（用紙 3mm×1.4）を実寸に。浮動小数の端数（420.00000000000006）を 0.01mm で切る
    const gap = Math.round(OCCUPANCY_TEXT_PAPER_MM * OCCUPANCY_LINE_HEIGHT * drawing.scale * 100) / 100;
    return { x: minX, y: minY - gap };
}

// ---------------------------------------------------------------------------
// 申請書に入れる
// ---------------------------------------------------------------------------

/** 占用範囲を並べた順に「申請書に入れる」ための形にする */
export function occupancyApplyItems(entities: readonly Pick<OccupancyEntity, 'points' | 'routeName'>[]): OccupancyApplyItem[] {
    return entities.map((e) => {
        const m = occupancyMeasure(e.points);
        return { routeName: e.routeName.trim(), areaN: m.areaN, areaText: m.areaText, expression: m.expression };
    });
}

/** 合計（ちょうどの値どうしを整数で足す）と「約○㎡」 */
export function occupancyTotal(items: readonly Pick<OccupancyApplyItem, 'areaN'>[]): OccupancyTotal {
    const areaN = items.reduce((s, m) => s + m.areaN, 0);
    return { areaN, areaText: areaTextOf(areaN), approx: occupancyApprox(areaN) };
}

/**
 * 申請書の占用物件（values.occupancy）に入れる値（範囲の数にかかわらず同じ。許可が出た松山市の書類 3 件と同じ書き方）:
 * 規模＝「別紙記入」・長さ＝空・幅＝空・数量＝合計（ちょうどの値）。
 * 「約○㎡」（areaApprox）は触らない（自動＝切り上げのまま）。0 件なら null
 */
export function occupancyFormPatch(
    items: readonly Pick<OccupancyApplyItem, 'areaN'>[],
): Pick<RoadPermitOccupancy, 'length' | 'width' | 'quantity' | 'scaleNote'> | null {
    if (items.length === 0) return null;
    return { length: '', width: '', quantity: occupancyTotal(items).areaText, scaleNote: '別紙記入' };
}
