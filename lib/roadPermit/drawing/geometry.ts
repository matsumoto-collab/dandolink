/**
 * 図面の幾何計算（純粋関数・実寸 mm・Y 上向き）。
 * 読取点の候補・選択の当たり判定・面積・回転／反転 など、作図画面と PDF と 2b（占用面積）で使う。
 *
 * 記号（SymbolEntity）は、記号の表（symbols）を渡せば本物の形（lib/roadPermit/symbols/geometry.ts の
 * placedSymbol*）で当たり判定・範囲・読取点を出す。渡さないか表に無いときは、基準点のまわりの小さな四角（実寸 100mm）。
 */
import type { RoadPermitSymbolDto, RoadPermitSymbolMap } from '@/types/roadPermitSymbol';
import {
    isSymbolGeometryEmpty,
    placedSymbolBBox,
    placedSymbolCorners,
    placedSymbolSegments,
} from '@/lib/roadPermit/symbols/geometry';
import type {
    ArcEntity,
    CircleEntity,
    DimensionEntity,
    DrawingEntity,
    DrawingPoint,
    HatchEntity,
    LeaderEntity,
    OccupancyEntity,
    LineEntity,
    PolylineEntity,
    SymbolEntity,
} from '@/types/roadPermitDrawing';

export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

const EPS = 1e-9;

export function distance(a: DrawingPoint, b: DrawingPoint): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: DrawingPoint, b: DrawingPoint): DrawingPoint {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function add(a: DrawingPoint, b: DrawingPoint): DrawingPoint {
    return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: DrawingPoint, b: DrawingPoint): DrawingPoint {
    return { x: a.x - b.x, y: a.y - b.y };
}

export function scaleVec(v: DrawingPoint, k: number): DrawingPoint {
    return { x: v.x * k, y: v.y * k };
}

/** 角度（度・反時計回り）と長さ → ベクトル */
export function polar(lengthMm: number, angleDeg: number): DrawingPoint {
    const r = (angleDeg * Math.PI) / 180;
    return { x: lengthMm * Math.cos(r), y: lengthMm * Math.sin(r) };
}

/** a→b の角度（度・-180〜180・反時計回り） */
export function angleDeg(a: DrawingPoint, b: DrawingPoint): number {
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** 単位ベクトル（a→b）。長さ 0 なら (1,0) */
export function unit(a: DrawingPoint, b: DrawingPoint): DrawingPoint {
    const len = distance(a, b);
    if (len < EPS) return { x: 1, y: 0 };
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** a→b に直交する単位ベクトル（左側＝反時計回りに 90 度） */
export function perpendicularUnit(a: DrawingPoint, b: DrawingPoint): DrawingPoint {
    const u = unit(a, b);
    return { x: -u.y, y: u.x };
}

/** Shift を押したときの水平・垂直の固定（始点からの向きで近い方） */
export function orthoSnap(from: DrawingPoint, to: DrawingPoint): DrawingPoint {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

/** 点を center のまわりに deg 回転 */
export function rotatePoint(p: DrawingPoint, center: DrawingPoint, deg: number): DrawingPoint {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

/** 点を直線 a-b で反転（鏡映） */
export function mirrorPoint(p: DrawingPoint, a: DrawingPoint, b: DrawingPoint): DrawingPoint {
    const u = unit(a, b);
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const dot = dx * u.x + dy * u.y;
    const proj = { x: a.x + u.x * dot, y: a.y + u.y * dot };
    return { x: proj.x * 2 - p.x, y: proj.y * 2 - p.y };
}

/** 線分 a-b と点 p の距離と、最も近い点 */
export function pointToSegment(p: DrawingPoint, a: DrawingPoint, b: DrawingPoint): { dist: number; closest: DrawingPoint; t: number } {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 < EPS ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const closest = { x: a.x + abx * t, y: a.y + aby * t };
    return { dist: distance(p, closest), closest, t };
}

/** 線分 p1-p2 と p3-p4 の交点（線分の内側にあるときだけ）。無ければ null */
export function segmentIntersection(p1: DrawingPoint, p2: DrawingPoint, p3: DrawingPoint, p4: DrawingPoint): DrawingPoint | null {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < EPS) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
    return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
}

/** 多角形の面積（mm²・符号なし。靴ひも公式） */
export function polygonArea(points: readonly DrawingPoint[]): number {
    if (points.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
}

/** mm² → m²（小数 4 桁） */
export function mm2ToM2(mm2: number): number {
    return Math.round((mm2 / 1_000_000) * 10000) / 10000;
}

/** 折れ線の長さ */
export function polylineLength(points: readonly DrawingPoint[], closed: boolean): number {
    let len = 0;
    const n = closed ? points.length : points.length - 1;
    for (let i = 0; i < n; i++) len += distance(points[i], points[(i + 1) % points.length]);
    return len;
}

/** 点が多角形の内側か（偶奇規則） */
export function pointInPolygon(p: DrawingPoint, polygon: readonly DrawingPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// ---------------------------------------------------------------------------
// 図形 → 線分の集まり（当たり判定・交点・範囲の計算に使う）
// ---------------------------------------------------------------------------

export type Segment = [DrawingPoint, DrawingPoint];

/** 円弧の点列（描画・当たり判定用。分割数は角度に応じて） */
export function arcPoints(arc: Pick<ArcEntity, 'center' | 'r' | 'startDeg' | 'endDeg'>, steps?: number): DrawingPoint[] {
    let sweep = arc.endDeg - arc.startDeg;
    while (sweep <= 0) sweep += 360;
    const n = steps ?? Math.max(8, Math.ceil(sweep / 5));
    const pts: DrawingPoint[] = [];
    for (let i = 0; i <= n; i++) {
        const deg = arc.startDeg + (sweep * i) / n;
        pts.push(add(arc.center, polar(arc.r, deg)));
    }
    return pts;
}

export function circlePoints(c: Pick<CircleEntity, 'center' | 'r'>, steps = 48): DrawingPoint[] {
    return arcPoints({ center: c.center, r: c.r, startDeg: 0, endDeg: 360 }, steps);
}

function polyToSegments(points: readonly DrawingPoint[], closed: boolean): Segment[] {
    const segs: Segment[] = [];
    const n = closed ? points.length : points.length - 1;
    for (let i = 0; i < n; i++) segs.push([points[i], points[(i + 1) % points.length]]);
    return segs;
}

/** 寸法の 寸法線の 2 端点（a・b を offsetMm だけ離した位置） */
export function dimensionLinePoints(dim: Pick<DimensionEntity, 'a' | 'b' | 'offsetMm' | 'mode'>): { p1: DrawingPoint; p2: DrawingPoint } {
    if (dim.mode === 'horizontal') {
        const y = Math.max(dim.a.y, dim.b.y) + dim.offsetMm;
        return { p1: { x: dim.a.x, y }, p2: { x: dim.b.x, y } };
    }
    if (dim.mode === 'vertical') {
        const x = Math.max(dim.a.x, dim.b.x) + dim.offsetMm;
        return { p1: { x, y: dim.a.y }, p2: { x, y: dim.b.y } };
    }
    const n = perpendicularUnit(dim.a, dim.b);
    const off = scaleVec(n, dim.offsetMm);
    return { p1: add(dim.a, off), p2: add(dim.b, off) };
}

/** 寸法の測った長さ（mm） */
export function dimensionValue(dim: Pick<DimensionEntity, 'a' | 'b' | 'mode'>): number {
    if (dim.mode === 'horizontal') return Math.abs(dim.b.x - dim.a.x);
    if (dim.mode === 'vertical') return Math.abs(dim.b.y - dim.a.y);
    return distance(dim.a, dim.b);
}

/** 寸法値の表記（整数 mm・3 桁区切り。手で上書きしていればその文字） */
export function dimensionLabel(dim: Pick<DimensionEntity, 'a' | 'b' | 'mode' | 'textOverride'>): string {
    if (dim.textOverride != null && dim.textOverride !== '') return dim.textOverride;
    return Math.round(dimensionValue(dim)).toLocaleString('ja-JP');
}

/** 記号の表から、その記号（形が空でないもの）を引く。無ければ null（小さな四角で扱う） */
export function symbolFor(e: SymbolEntity, symbols?: RoadPermitSymbolMap | null): RoadPermitSymbolDto | null {
    if (!symbols) return null;
    const s = symbols.get(e.symbolId);
    if (!s || isSymbolGeometryEmpty(s.geometry)) return null;
    return s;
}

/** 図形を線分の集まりにする（文字・表に無い記号は基準点のまわりの小さな四角。記号の表を渡せば記号は本物の形） */
export function entitySegments(e: DrawingEntity, symbols?: RoadPermitSymbolMap | null): Segment[] {
    if (e.kind === 'symbol') {
        const sym = symbolFor(e, symbols);
        if (sym) return placedSymbolSegments(sym.geometry, e);
    }
    switch (e.kind) {
        case 'line':
            return [[e.a, e.b]];
        case 'polyline':
            return polyToSegments(e.points, e.closed);
        case 'circle':
            return polyToSegments(circlePoints(e), true);
        case 'arc':
            return polyToSegments(arcPoints(e), false);
        case 'dimension': {
            const { p1, p2 } = dimensionLinePoints(e);
            return [[p1, p2], [e.a, p1], [e.b, p2]];
        }
        case 'leader':
            return polyToSegments(e.points, false);
        case 'hatch':
        case 'occupancy':
            return polyToSegments(e.points, true);
        case 'text':
        case 'symbol': {
            const p = e.kind === 'text' ? e.at : e.at;
            const r = 100; // 当たり判定用の小さな四角（実寸 100mm）
            const q = [
                { x: p.x - r, y: p.y - r },
                { x: p.x + r, y: p.y - r },
                { x: p.x + r, y: p.y + r },
                { x: p.x - r, y: p.y + r },
            ];
            return polyToSegments(q, true);
        }
        default:
            return [];
    }
}

/** 図形の読取点の候補（端点・中点・中心）。交点は snapCandidates で別に出す。記号（表にあるもの）は 中心＋外形の 4 隅 */
export function entitySnapPoints(e: DrawingEntity, symbols?: RoadPermitSymbolMap | null): { kind: 'end' | 'mid' | 'center'; p: DrawingPoint }[] {
    const out: { kind: 'end' | 'mid' | 'center'; p: DrawingPoint }[] = [];
    const pushSegs = (segs: Segment[]) => {
        for (const [a, b] of segs) {
            out.push({ kind: 'end', p: a }, { kind: 'end', p: b }, { kind: 'mid', p: midpoint(a, b) });
        }
    };
    switch (e.kind) {
        case 'line':
            pushSegs([[e.a, e.b]]);
            break;
        case 'polyline':
        case 'hatch':
        case 'occupancy':
            pushSegs(polyToSegments(e.points, e.kind === 'polyline' ? e.closed : true));
            break;
        case 'leader':
            pushSegs(polyToSegments(e.points, false));
            break;
        case 'circle':
            out.push({ kind: 'center', p: e.center });
            for (const deg of [0, 90, 180, 270]) out.push({ kind: 'end', p: add(e.center, polar(e.r, deg)) });
            break;
        case 'arc':
            out.push({ kind: 'center', p: e.center });
            out.push({ kind: 'end', p: add(e.center, polar(e.r, e.startDeg)) });
            out.push({ kind: 'end', p: add(e.center, polar(e.r, e.endDeg)) });
            break;
        case 'dimension': {
            const { p1, p2 } = dimensionLinePoints(e);
            out.push({ kind: 'end', p: e.a }, { kind: 'end', p: e.b }, { kind: 'end', p: p1 }, { kind: 'end', p: p2 });
            break;
        }
        case 'text':
            out.push({ kind: 'end', p: e.at });
            break;
        case 'symbol': {
            const sym = symbolFor(e, symbols);
            if (sym) {
                out.push({ kind: 'center', p: e.at });
                for (const p of placedSymbolCorners(sym.geometry, e)) out.push({ kind: 'end', p });
            } else {
                out.push({ kind: 'end', p: e.at });
            }
            break;
        }
    }
    return out;
}

export interface SnapCandidate {
    kind: 'end' | 'mid' | 'center' | 'intersection';
    p: DrawingPoint;
    dist: number;
}

/**
 * 読取点（右クリック）の候補のうち、p にいちばん近いもの。tolerance（実寸 mm）より遠ければ null。
 * 優先順: 端点 > 交点 > 中点 > 中心（同じ距離のとき）
 */
export function snapCandidate(
    p: DrawingPoint,
    entities: readonly DrawingEntity[],
    toleranceMm: number,
    symbols?: RoadPermitSymbolMap | null,
): SnapCandidate | null {
    const rank: Record<SnapCandidate['kind'], number> = { end: 0, intersection: 1, mid: 2, center: 3 };
    let best: SnapCandidate | null = null;
    const consider = (c: SnapCandidate) => {
        if (c.dist > toleranceMm) return;
        if (!best || c.dist < best.dist - EPS || (Math.abs(c.dist - best.dist) <= EPS && rank[c.kind] < rank[best.kind])) best = c;
    };
    const near: DrawingEntity[] = [];
    for (const e of entities) {
        const bb = entityBBox(e, symbols);
        if (p.x < bb.minX - toleranceMm || p.x > bb.maxX + toleranceMm || p.y < bb.minY - toleranceMm || p.y > bb.maxY + toleranceMm) continue;
        near.push(e);
        for (const sp of entitySnapPoints(e, symbols)) consider({ kind: sp.kind, p: sp.p, dist: distance(p, sp.p) });
    }
    // 交点（近くの図形どうし）
    const segsOf = near.map((e) => entitySegments(e, symbols).filter(([a, b]) => pointToSegment(p, a, b).dist <= toleranceMm * 4));
    for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
            for (const [a1, b1] of segsOf[i]) {
                for (const [a2, b2] of segsOf[j]) {
                    const x = segmentIntersection(a1, b1, a2, b2);
                    if (x) consider({ kind: 'intersection', p: x, dist: distance(p, x) });
                }
            }
        }
    }
    return best;
}

/** 図形の外接の範囲（記号の表を渡せば、記号は置いた形の範囲） */
export function entityBBox(e: DrawingEntity, symbols?: RoadPermitSymbolMap | null): BBox {
    if (e.kind === 'symbol') {
        const sym = symbolFor(e, symbols);
        if (sym) return placedSymbolBBox(sym.geometry, e);
    }
    const pts: DrawingPoint[] = [];
    for (const [a, b] of entitySegments(e)) pts.push(a, b);
    if (e.kind === 'circle') {
        pts.push({ x: e.center.x - e.r, y: e.center.y - e.r }, { x: e.center.x + e.r, y: e.center.y + e.r });
    }
    return bboxOf(pts);
}

export function bboxOf(points: readonly DrawingPoint[]): BBox {
    if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

export function entitiesBBox(entities: readonly DrawingEntity[], symbols?: RoadPermitSymbolMap | null): BBox | null {
    if (entities.length === 0) return null;
    const boxes = entities.map((e) => entityBBox(e, symbols));
    return {
        minX: Math.min(...boxes.map((b) => b.minX)),
        minY: Math.min(...boxes.map((b) => b.minY)),
        maxX: Math.max(...boxes.map((b) => b.maxX)),
        maxY: Math.max(...boxes.map((b) => b.maxY)),
    };
}

/** 点 p から図形までの距離（線分への最短）。文字・表に無い記号は基準点まで。表にある記号は記号の線まで */
export function entityDistance(e: DrawingEntity, p: DrawingPoint, symbols?: RoadPermitSymbolMap | null): number {
    if (e.kind === 'symbol') {
        const sym = symbolFor(e, symbols);
        if (!sym) return distance(p, e.at);
        let best = distance(p, e.at);
        for (const [a, b] of placedSymbolSegments(sym.geometry, e)) best = Math.min(best, pointToSegment(p, a, b).dist);
        return best;
    }
    if (e.kind === 'text') return distance(p, e.at);
    if (e.kind === 'circle') return Math.abs(distance(p, e.center) - e.r);
    let best = Infinity;
    for (const [a, b] of entitySegments(e)) best = Math.min(best, pointToSegment(p, a, b).dist);
    return best;
}

/** クリックで選ぶ: p にいちばん近い図形（tolerance 以内）。無ければ null */
export function pickEntity(
    p: DrawingPoint,
    entities: readonly DrawingEntity[],
    toleranceMm: number,
    symbols?: RoadPermitSymbolMap | null,
): DrawingEntity | null {
    let best: DrawingEntity | null = null;
    let bestD = toleranceMm;
    for (const e of entities) {
        const d = entityDistance(e, p, symbols);
        if (d <= bestD) {
            bestD = d;
            best = e;
        }
    }
    return best;
}

/** 範囲選択: 矩形に全部入っている図形 */
export function entitiesInRect(rect: BBox, entities: readonly DrawingEntity[], symbols?: RoadPermitSymbolMap | null): DrawingEntity[] {
    return entities.filter((e) => {
        const b = entityBBox(e, symbols);
        return b.minX >= rect.minX && b.maxX <= rect.maxX && b.minY >= rect.minY && b.maxY <= rect.maxY;
    });
}

// ---------------------------------------------------------------------------
// 図形の変換（移動・回転・反転・複写）
// ---------------------------------------------------------------------------

function mapPoints(e: DrawingEntity, f: (p: DrawingPoint) => DrawingPoint): DrawingEntity {
    switch (e.kind) {
        case 'line':
            return { ...e, a: f(e.a), b: f(e.b) };
        case 'polyline':
            return { ...e, points: e.points.map(f) };
        case 'hatch':
            return { ...e, points: e.points.map(f) };
        case 'leader':
            return { ...e, points: e.points.map(f) };
        case 'occupancy':
            return { ...e, points: e.points.map(f) };
        case 'circle':
            return { ...e, center: f(e.center) };
        case 'arc':
            return { ...e, center: f(e.center) };
        case 'dimension':
            return { ...e, a: f(e.a), b: f(e.b) };
        case 'text':
            return { ...e, at: f(e.at) };
        case 'symbol':
            return { ...e, at: f(e.at) };
    }
}

export function translateEntity(e: DrawingEntity, delta: DrawingPoint): DrawingEntity {
    return mapPoints(e, (p) => add(p, delta));
}

export function rotateEntity(e: DrawingEntity, center: DrawingPoint, deg: number): DrawingEntity {
    const r = mapPoints(e, (p) => rotatePoint(p, center, deg));
    if (r.kind === 'arc') return { ...r, startDeg: r.startDeg + deg, endDeg: r.endDeg + deg };
    if (r.kind === 'text') return { ...r, rotationDeg: r.rotationDeg + deg };
    if (r.kind === 'symbol') return { ...r, rotationDeg: r.rotationDeg + deg };
    return r;
}

export function mirrorEntity(e: DrawingEntity, a: DrawingPoint, b: DrawingPoint): DrawingEntity {
    const r = mapPoints(e, (p) => mirrorPoint(p, a, b));
    if (r.kind === 'arc') {
        // 鏡映で向きが反転するので 始点と終点を入れ替える（角度も鏡映）
        const axis = angleDeg(a, b);
        const s = 2 * axis - r.endDeg;
        const en = 2 * axis - r.startDeg;
        return { ...r, startDeg: s, endDeg: en };
    }
    if (r.kind === 'symbol') return { ...r, mirrored: !r.mirrored };
    return r;
}

// ---------------------------------------------------------------------------
// 2線（幅を指定して中心線の両側に 2 本）・ハッチの斜線
// ---------------------------------------------------------------------------

/** 2線: 中心線 a-b と幅 → 左右 2 本の線分 */
export function doubleLine(a: DrawingPoint, b: DrawingPoint, widthMm: number): { left: Segment; right: Segment } {
    const n = scaleVec(perpendicularUnit(a, b), widthMm / 2);
    return {
        left: [add(a, n), add(b, n)],
        right: [sub(a, n), sub(b, n)],
    };
}

/**
 * ハッチの斜線: 多角形の中を角度 deg の平行線で埋める（間隔 spacingMm・実寸）。
 * 各線と多角形の辺の交点を並べ、内側の区間だけを線分にする。
 */
export function hatchLines(points: readonly DrawingPoint[], spacingMm: number, deg = 45): Segment[] {
    if (points.length < 3 || spacingMm <= 0) return [];
    const r = (deg * Math.PI) / 180;
    const dir = { x: Math.cos(r), y: Math.sin(r) };
    const nrm = { x: -dir.y, y: dir.x };
    // 法線方向の範囲
    const ds = points.map((p) => p.x * nrm.x + p.y * nrm.y);
    const minD = Math.min(...ds);
    const maxD = Math.max(...ds);
    const ts = points.map((p) => p.x * dir.x + p.y * dir.y);
    const minT = Math.min(...ts) - 1;
    const maxT = Math.max(...ts) + 1;
    const edges = polyToSegments(points, true);
    const out: Segment[] = [];
    for (let d = Math.ceil(minD / spacingMm) * spacingMm; d <= maxD; d += spacingMm) {
        const p1 = { x: nrm.x * d + dir.x * minT, y: nrm.y * d + dir.y * minT };
        const p2 = { x: nrm.x * d + dir.x * maxT, y: nrm.y * d + dir.y * maxT };
        const xs: number[] = [];
        for (const [a, b] of edges) {
            const x = segmentIntersection(p1, p2, a, b);
            if (x) xs.push(x.x * dir.x + x.y * dir.y);
        }
        xs.sort((u, v) => u - v);
        for (let i = 0; i + 1 < xs.length; i += 2) {
            if (xs[i + 1] - xs[i] < EPS) continue;
            out.push([
                { x: nrm.x * d + dir.x * xs[i], y: nrm.y * d + dir.y * xs[i] },
                { x: nrm.x * d + dir.x * xs[i + 1], y: nrm.y * d + dir.y * xs[i + 1] },
            ]);
        }
    }
    return out;
}

export type { LineEntity, PolylineEntity, CircleEntity, ArcEntity, DimensionEntity, LeaderEntity, HatchEntity, OccupancyEntity };
