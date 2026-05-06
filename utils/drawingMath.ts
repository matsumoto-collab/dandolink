// 作図機能のコア計算ロジック（純粋関数のみ）
import type {
    Point,
    Section,
    Direction,
    BoundingBox,
    CanvasFit,
    DrawingStats,
} from '@/stores/siteSurveySlices/types';

export function distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// 多角形の外周（mm）。closed=true の場合は最後と最初を結ぶ辺も加算。
export function perimeterMm(points: Point[], closed: boolean): number {
    if (points.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        total += distance(points[i], points[i + 1]);
    }
    if (closed && points.length >= 3) {
        total += distance(points[points.length - 1], points[0]);
    }
    return total;
}

// Shoelace formula。順回り/逆回り問わず絶対値を返す（mm²）。
export function polygonAreaMm2(points: Point[]): number {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

// 足場掛面積（㎡）= (外周m + 補正値m) × 軒高m
export function scaffoldArea(perimeterM: number, heightMm: number, correctionM = 0): number {
    return (perimeterM + correctionM) * (heightMm / 1000);
}

// 単一セクションの統計を計算
export function computeStats(section: Section, correctionM = 0): DrawingStats {
    const points = section.polygon.points;
    const closed = section.polygon.closed;
    const perimeterM = perimeterMm(points, closed) / 1000;
    const floorArea = closed ? polygonAreaMm2(points) / 1_000_000 : 0;
    const scaffold = scaffoldArea(perimeterM, section.height, correctionM);
    return {
        perimeter: perimeterM,
        floorArea,
        scaffoldArea: scaffold,
    };
}

// 全セクション合算の統計
export function computeTotalStats(
    sections: Section[],
    correctionM: number = 0,
): DrawingStats {
    let perimeter = 0;
    let floorArea = 0;
    let scaffoldArea = 0;
    for (const s of sections) {
        const partial = computeStats(s, correctionM);
        perimeter += partial.perimeter;
        floorArea += partial.floorArea;
        scaffoldArea += partial.scaffoldArea;
    }
    return { perimeter, floorArea, scaffoldArea };
}

// 8 方向の単位ベクトル
const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
    N: { dx: 0, dy: -1 },
    NE: { dx: Math.SQRT1_2, dy: -Math.SQRT1_2 },
    E: { dx: 1, dy: 0 },
    SE: { dx: Math.SQRT1_2, dy: Math.SQRT1_2 },
    S: { dx: 0, dy: 1 },
    SW: { dx: -Math.SQRT1_2, dy: Math.SQRT1_2 },
    W: { dx: -1, dy: 0 },
    NW: { dx: -Math.SQRT1_2, dy: -Math.SQRT1_2 },
};

export function directionVector(dir: Direction): { dx: number; dy: number } {
    return DIRECTION_VECTORS[dir];
}

// ドラッグベクトルから 8 方向にスナップ
export function snapTo8Dir(dx: number, dy: number): Direction {
    if (dx === 0 && dy === 0) return 'E';
    // atan2 は y 下向きを正とする screen 座標に従う
    // angle: 0=E, 90=S, 180=W, -90=N
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    // 0..360 に正規化
    const a = (angle + 360) % 360;
    // 22.5° ごとに 8 方向にスナップ
    if (a < 22.5 || a >= 337.5) return 'E';
    if (a < 67.5) return 'SE';
    if (a < 112.5) return 'S';
    if (a < 157.5) return 'SW';
    if (a < 202.5) return 'W';
    if (a < 247.5) return 'NW';
    if (a < 292.5) return 'N';
    return 'NE';
}

export function computeBoundingBox(points: Point[]): BoundingBox {
    if (points.length === 0) {
        return { minX: 0, maxX: 10000, minY: 0, maxY: 10000 };
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
}

// バウンディングボックスをキャンバスに収めるためのスケール・オフセット
export function fitToCanvas(
    bbox: BoundingBox,
    canvasW: number,
    canvasH: number,
    padding = 40,
): CanvasFit {
    const w = Math.max(1, bbox.maxX - bbox.minX);
    const h = Math.max(1, bbox.maxY - bbox.minY);
    const availW = Math.max(1, canvasW - padding * 2);
    const availH = Math.max(1, canvasH - padding * 2);
    const scale = Math.min(availW / w, availH / h);
    const offsetX = padding - bbox.minX * scale + (availW - w * scale) / 2;
    const offsetY = padding - bbox.minY * scale + (availH - h * scale) / 2;
    return { scale, offsetX, offsetY };
}

// px → mm
export function pxToMm(px: { x: number; y: number }, fit: CanvasFit): Point {
    return {
        x: (px.x - fit.offsetX) / fit.scale,
        y: (px.y - fit.offsetY) / fit.scale,
    };
}

// mm → px
export function mmToPx(mm: Point, fit: CanvasFit): { x: number; y: number } {
    return {
        x: mm.x * fit.scale + fit.offsetX,
        y: mm.y * fit.scale + fit.offsetY,
    };
}

// 起点との距離が threshold(mm) 以内なら閉じ可能
export function canCloseAt(section: Section, candidateMm: Point, thresholdMm = 800): boolean {
    const pts = section.polygon.points;
    if (section.polygon.closed) return false;
    if (pts.length < 3) return false;
    return distance(pts[0], candidateMm) <= thresholdMm;
}

export const SNAP_GRID_MM = 100; // 10cm 単位スナップ

// mm 座標を 10mm 単位の最も近い角に丸める
export function snapToGrid(p: Point, gridMm: number = SNAP_GRID_MM): Point {
    return {
        x: Math.round(p.x / gridMm) * gridMm,
        y: Math.round(p.y / gridMm) * gridMm,
    };
}

// 現在のスケールに応じて、画面上で見やすい minor / major グリッド間隔を返す
// scale: px/mm
export function chooseGridSpacing(
    scale: number,
    minPxBetweenLines: number = 8,
): { minor: number; major: number } {
    const candidates = [100, 500, 1000, 5000, 10000, 50000]; // mm
    let minor = candidates[candidates.length - 1];
    for (const c of candidates) {
        if (c * scale >= minPxBetweenLines) {
            minor = c;
            break;
        }
    }
    let major = minor * 10;
    if (!candidates.includes(major)) {
        major = candidates.find((c) => c >= minor * 5) ?? minor * 10;
    }
    return { minor, major };
}

// 線中点の座標を返す（寸法ラベル配置用）
export function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// 線分 (a → b) と点 p の最短距離を mm で返す。t は線分上の投影位置 (0..1, クランプ)
export function distancePointToSegment(
    p: Point,
    a: Point,
    b: Point,
): { distance: number; t: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return { distance: distance(p, a), t: 0 };
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const d = Math.hypot(p.x - projX, p.y - projY);
    return { distance: d, t };
}

// section の壁一覧（閉じてる場合は wrap-around も含む）
export function getWalls(section: Section): Array<{
    a: Point;
    b: Point;
    wallIndex: number;
    length: number;
}> {
    const pts = section.polygon.points;
    const out: Array<{ a: Point; b: Point; wallIndex: number; length: number }> = [];
    const last = section.polygon.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        out.push({ a, b, wallIndex: i, length: distance(a, b) });
    }
    return out;
}

// 線に垂直な単位ベクトル（ティック線・ラベル位置決め用）
export function perpendicularUnit(a: Point, b: Point): { x: number; y: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return { x: 0, y: 0 };
    return { x: -dy / len, y: dx / len };
}
