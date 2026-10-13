/**
 * 占用範囲の面積と式（純粋関数・指示書 docs/指示書_道路申請_Phase2b_記号.md §5.4・設計書 §6.6）。
 *
 * 式の書き方は ashiba3d 旧版の ovExpr と同じ:
 * - 長方形（回転していてもよい）→「0.81×11.10＝8.991㎡」（出幅 m × 延長 m）
 * - 三角形 →「1.53×10.08÷2＝7.716㎡」（高さ × 底辺 ÷ 2）
 * - その他 →「7.716㎡（出幅 0.77・延長 10.08）」（延長＝いちばん長い辺・出幅＝面積÷延長）
 * 数の表記: m は toFixed(2)、面積は toFixed(3)。「約○㎡」は申請書と同じ approxAreaOf（lib/roadPermit/format.ts）に任せる。
 */
import type { DrawingPoint, OccupancyEntity } from '@/types/roadPermitDrawing';
import type { RoadPermitOccupancy } from '@/types/roadPermit';
import { distance, polygonArea } from '@/lib/roadPermit/drawing/geometry';

export type OccupancyShapeKind = 'rect' | 'triangle' | 'other';

export interface OccupancyMeasure {
    /** 面積（㎡・小数 3 桁に丸めた値） */
    areaM2: number;
    /** 延長（m・丸めない） */
    lengthM: number;
    /** 出幅（m・丸めない。三角形は高さ） */
    widthM: number;
    kind: OccupancyShapeKind;
    /** 式（例「0.81×11.10＝8.991㎡」） */
    expression: string;
}

/** 申請書に入れるときに親へ渡す 1 つ分（路線名つき） */
export interface OccupancyApplyItem extends Pick<OccupancyMeasure, 'areaM2' | 'lengthM' | 'widthM' | 'expression'> {
    routeName: string;
}

/** 直角とみなす誤差（度） */
const RIGHT_ANGLE_TOL_DEG = 0.5;
/** 向かい合う辺が「等しい」とみなす誤差（長さの割合と、最低 1mm） */
const EQUAL_LEN_RATIO = 1e-3;

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const m2 = (v: number) => v.toFixed(2);
const a3 = (v: number) => v.toFixed(3);

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

/** 占用範囲の面積・延長・出幅・式（points は実寸 mm） */
export function occupancyMeasure(points: readonly DrawingPoint[]): OccupancyMeasure {
    const pts = openRing(points);
    const areaMm2 = polygonArea(pts);
    const areaM2 = round3(areaMm2 / 1_000_000);
    if (pts.length < 3 || areaMm2 <= 0) {
        return { areaM2: 0, lengthM: 0, widthM: 0, kind: 'other', expression: `${a3(0)}㎡` };
    }
    const L = edgeLengths(pts);
    const longest = Math.max(...L);

    if (isRectangle(pts)) {
        const lengthM = Math.max(L[0], L[1]) / 1000;
        const widthM = Math.min(L[0], L[1]) / 1000;
        return { areaM2, lengthM, widthM, kind: 'rect', expression: `${m2(widthM)}×${m2(lengthM)}＝${a3(areaM2)}㎡` };
    }
    if (pts.length === 3) {
        const lengthM = longest / 1000;
        const widthM = (areaMm2 * 2) / longest / 1000;
        return { areaM2, lengthM, widthM, kind: 'triangle', expression: `${m2(widthM)}×${m2(lengthM)}÷2＝${a3(areaM2)}㎡` };
    }
    const lengthM = longest / 1000;
    const widthM = areaMm2 / longest / 1000;
    return { areaM2, lengthM, widthM, kind: 'other', expression: `${a3(areaM2)}㎡（出幅 ${m2(widthM)}・延長 ${m2(lengthM)}）` };
}

/** 図面の中に出す文字（例「市道 新屋敷線 占用 8.991㎡」。路線名が空なら「占用 8.991㎡」） */
export function occupancyLabel(e: Pick<OccupancyEntity, 'points' | 'routeName'>): string {
    const area = a3(occupancyMeasure(e.points).areaM2);
    const route = e.routeName.trim();
    return route ? `${route} 占用 ${area}㎡` : `占用 ${area}㎡`;
}

/** 文字を置く位置（多角形の重心。つぶれた形は点の平均） */
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

/** 占用範囲を並べた順に「申請書に入れる」ための形にする */
export function occupancyApplyItems(entities: readonly OccupancyEntity[]): OccupancyApplyItem[] {
    return entities.map((e) => {
        const m = occupancyMeasure(e.points);
        return { routeName: e.routeName.trim(), areaM2: m.areaM2, lengthM: m.lengthM, widthM: m.widthM, expression: m.expression };
    });
}

/** 占用範囲の合計面積（㎡・各面積を小数 3 桁にしてから足す） */
export function occupancyTotalM2(items: readonly Pick<OccupancyMeasure, 'areaM2'>[]): number {
    return round3(items.reduce((s, m) => s + round3(m.areaM2), 0));
}

/**
 * 申請書の占用物件（values.occupancy）に入れる値。
 * - 1 つ: 長さ＝延長・幅＝出幅（m・小数 2 桁）・数量＝面積（小数 3 桁）・規模の文言＝空
 * - 2 つ以上: 規模の文言＝「路線名 面積㎡」を「／」でつないだ文（路線名が空なら「占用範囲 n」）・長さ／幅＝空・数量＝合計
 * 「約○㎡」（areaApprox）は触らない（自動＝切り上げのまま）。0 件なら null
 */
export function occupancyFormPatch(
    items: readonly OccupancyApplyItem[],
): Pick<RoadPermitOccupancy, 'length' | 'width' | 'quantity' | 'scaleNote'> | null {
    if (items.length === 0) return null;
    if (items.length === 1) {
        const m = items[0];
        return { length: m2(m.lengthM), width: m2(m.widthM), quantity: a3(m.areaM2), scaleNote: '' };
    }
    const scaleNote = items.map((m, i) => `${m.routeName || `占用範囲 ${i + 1}`} ${a3(m.areaM2)}㎡`).join('／');
    return { length: '', width: '', quantity: a3(occupancyTotalM2(items)), scaleNote };
}
