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

// 線中点の座標を返す（寸法ラベル配置用）
export function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// 線に垂直な単位ベクトル（ティック線・ラベル位置決め用）
export function perpendicularUnit(a: Point, b: Point): { x: number; y: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return { x: 0, y: 0 };
    return { x: -dy / len, y: dx / len };
}
