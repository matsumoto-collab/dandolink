/**
 * 記号の形（RoadPermitSymbolGeometry）の幾何計算（純粋関数・実寸 mm・Y 上向き）。
 * 作図画面（konva）・PDF（react-pdf の Svg）・当たり判定・下絵（SVG）が同じ関数で形を点列にする。
 *
 * - 形は 基準点（中心）が原点。置くときは 反転（X を −X）→ 回転 → 移動 の順（SymbolPlacement）
 * - 円弧は startDeg〜endDeg の範囲だけを点列にする（円全体にしない。大きさの計算も同じ）
 */
import type { DrawingPoint } from '@/types/roadPermitDrawing';
import type { RoadPermitSymbolGeometry, SymbolPlacement } from '@/types/roadPermitSymbol';
import type { BBox, Segment } from '@/lib/roadPermit/drawing/geometry';

/** 円弧を点列にするときの 1 区切りの角度（度）。記号は小さく描かれるので粗くてよい */
export const SYMBOL_ARC_STEP_DEG = 10;

export function emptySymbolGeometry(): RoadPermitSymbolGeometry {
    return { lines: [], circles: [], arcs: [], polylines: [] };
}

/** 線・円・円弧・連続線の区間の合計（「線の本数」として画面に出す） */
export function symbolPrimitiveCount(g: RoadPermitSymbolGeometry): number {
    let n = Math.floor(g.lines.length / 4) + Math.floor(g.circles.length / 3) + Math.floor(g.arcs.length / 5);
    for (const poly of g.polylines) n += Math.max(0, Math.floor(poly.length / 2) - 1);
    return n;
}

/** 形が空か（線も円も円弧も連続線も無い） */
export function isSymbolGeometryEmpty(g: RoadPermitSymbolGeometry): boolean {
    return symbolPrimitiveCount(g) === 0;
}

function arcSamples(cx: number, cy: number, r: number, startDeg: number, endDeg: number, stepDeg: number): DrawingPoint[] {
    let sweep = endDeg - startDeg;
    while (sweep <= 0) sweep += 360;
    const n = Math.max(2, Math.ceil(sweep / stepDeg));
    const out: DrawingPoint[] = [];
    for (let i = 0; i <= n; i++) {
        const rad = ((startDeg + (sweep * i) / n) * Math.PI) / 180;
        out.push({ x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) });
    }
    return out;
}

/**
 * 形を点列（折れ線の集まり・記号の座標のまま）にする。
 * 線＝2 点、円＝閉じた点列（最初の点を最後にもう一度入れる）、円弧＝範囲だけの点列、連続線＝そのまま。
 */
export function symbolPolylines(g: RoadPermitSymbolGeometry, stepDeg = SYMBOL_ARC_STEP_DEG): DrawingPoint[][] {
    const out: DrawingPoint[][] = [];
    const L = g.lines;
    for (let i = 0; i + 3 < L.length; i += 4) out.push([{ x: L[i], y: L[i + 1] }, { x: L[i + 2], y: L[i + 3] }]);
    const C = g.circles;
    for (let i = 0; i + 2 < C.length; i += 3) {
        if (C[i + 2] <= 0) continue;
        const pts = arcSamples(C[i], C[i + 1], C[i + 2], 0, 360, stepDeg);
        out.push(pts);
    }
    const A = g.arcs;
    for (let i = 0; i + 4 < A.length; i += 5) {
        if (A[i + 2] <= 0) continue;
        out.push(arcSamples(A[i], A[i + 1], A[i + 2], A[i + 3], A[i + 4], stepDeg));
    }
    for (const poly of g.polylines) {
        const pts: DrawingPoint[] = [];
        for (let i = 0; i + 1 < poly.length; i += 2) pts.push({ x: poly[i], y: poly[i + 1] });
        if (pts.length >= 2) out.push(pts);
    }
    return out;
}

function bboxOfPolylines(polys: DrawingPoint[][]): BBox {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const poly of polys) {
        for (const p of poly) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
    }
    if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX, minY, maxX, maxY };
}

/** 形の外接の範囲（記号の座標。円弧は実際の範囲だけで測る） */
export function symbolBBox(g: RoadPermitSymbolGeometry): BBox {
    // 大きさは細かく測りたいので、円弧は 2 度刻み
    return bboxOfPolylines(symbolPolylines(g, 2));
}

function mapGeometry(g: RoadPermitSymbolGeometry, f: (x: number, y: number) => [number, number], k = 1): RoadPermitSymbolGeometry {
    const lines: number[] = [];
    for (let i = 0; i + 3 < g.lines.length; i += 4) {
        const a = f(g.lines[i], g.lines[i + 1]);
        const b = f(g.lines[i + 2], g.lines[i + 3]);
        lines.push(a[0], a[1], b[0], b[1]);
    }
    const circles: number[] = [];
    for (let i = 0; i + 2 < g.circles.length; i += 3) {
        const c = f(g.circles[i], g.circles[i + 1]);
        circles.push(c[0], c[1], g.circles[i + 2] * k);
    }
    const arcs: number[] = [];
    for (let i = 0; i + 4 < g.arcs.length; i += 5) {
        const c = f(g.arcs[i], g.arcs[i + 1]);
        arcs.push(c[0], c[1], g.arcs[i + 2] * k, g.arcs[i + 3], g.arcs[i + 4]);
    }
    const polylines = g.polylines.map((poly) => {
        const out: number[] = [];
        for (let i = 0; i + 1 < poly.length; i += 2) {
            const p = f(poly[i], poly[i + 1]);
            out.push(p[0], p[1]);
        }
        return out;
    });
    return { lines, circles, arcs, polylines };
}

/** 形を平行移動 */
export function translateSymbolGeometry(g: RoadPermitSymbolGeometry, dx: number, dy: number): RoadPermitSymbolGeometry {
    return mapGeometry(g, (x, y) => [x + dx, y + dy]);
}

/** 形を原点中心に k 倍（取り込み時に実寸へ直すのに使う） */
export function scaleSymbolGeometry(g: RoadPermitSymbolGeometry, k: number): RoadPermitSymbolGeometry {
    return mapGeometry(g, (x, y) => [x * k, y * k], k);
}

/** 外形の中心を原点にそろえ、大きさ（lengthMm＝横・widthMm＝縦）を出す */
export function centerSymbolGeometry(g: RoadPermitSymbolGeometry): { geometry: RoadPermitSymbolGeometry; lengthMm: number; widthMm: number } {
    const bb = symbolBBox(g);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    return {
        geometry: translateSymbolGeometry(g, -cx, -cy),
        lengthMm: bb.maxX - bb.minX,
        widthMm: bb.maxY - bb.minY,
    };
}

/** 記号の座標の点 → 図面の点（反転 → 回転 → 移動） */
export function placePoint(p: DrawingPoint, pl: SymbolPlacement): DrawingPoint {
    const x0 = pl.mirrored ? -p.x : p.x;
    const y0 = p.y;
    const rad = (pl.rotationDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return { x: pl.at.x + x0 * c - y0 * s, y: pl.at.y + x0 * s + y0 * c };
}

/** 置いた記号の点列（図面の座標） */
export function placedSymbolPolylines(g: RoadPermitSymbolGeometry, pl: SymbolPlacement, stepDeg = SYMBOL_ARC_STEP_DEG): DrawingPoint[][] {
    return symbolPolylines(g, stepDeg).map((poly) => poly.map((p) => placePoint(p, pl)));
}

/** 置いた記号の線分（当たり判定・交点に使う） */
export function placedSymbolSegments(g: RoadPermitSymbolGeometry, pl: SymbolPlacement, stepDeg = SYMBOL_ARC_STEP_DEG): Segment[] {
    const out: Segment[] = [];
    for (const poly of placedSymbolPolylines(g, pl, stepDeg)) {
        for (let i = 0; i + 1 < poly.length; i++) out.push([poly[i], poly[i + 1]]);
    }
    return out;
}

/** 置いた記号の外接の範囲（図面の座標） */
export function placedSymbolBBox(g: RoadPermitSymbolGeometry, pl: SymbolPlacement): BBox {
    return bboxOfPolylines(placedSymbolPolylines(g, pl, 2));
}

/** 置いた記号の外形の 4 隅（読取点の候補に使う。回転していれば回った四角の角） */
export function placedSymbolCorners(g: RoadPermitSymbolGeometry, pl: SymbolPlacement): DrawingPoint[] {
    const bb = symbolBBox(g);
    return [
        { x: bb.minX, y: bb.minY },
        { x: bb.maxX, y: bb.minY },
        { x: bb.maxX, y: bb.maxY },
        { x: bb.minX, y: bb.maxY },
    ].map((p) => placePoint(p, pl));
}
