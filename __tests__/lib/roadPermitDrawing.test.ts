/**
 * 道路申請の図面（Phase 2a）の土台: 幾何計算・用紙と座標変換・正規化。
 */
import {
    arcPoints,
    dimensionLabel,
    dimensionLinePoints,
    dimensionValue,
    distance,
    doubleLine,
    entitiesInRect,
    entityBBox,
    hatchLines,
    mirrorEntity,
    mirrorPoint,
    mm2ToM2,
    orthoSnap,
    pickEntity,
    pointInPolygon,
    polar,
    polygonArea,
    polylineLength,
    rotateEntity,
    rotatePoint,
    segmentIntersection,
    snapCandidate,
    translateEntity,
} from '@/lib/roadPermit/drawing/geometry';
import { fromPaper, originToFit, paperSizeMm, paperToPt, toPaper, toPt, PT_PER_MM } from '@/lib/roadPermit/drawing/paper';
import {
    DEFAULT_STYLE,
    emptyRoadPermitDrawing,
    isDrawingEmpty,
    normalizeEntity,
    normalizeRoadPermitDrawing,
} from '@/lib/roadPermit/drawing/defaults';
import type { DrawingEntity, LineEntity, PolylineEntity, SymbolEntity } from '@/types/roadPermitDrawing';
import type { RoadPermitSymbolDto } from '@/types/roadPermitSymbol';
import { toSymbolMap } from '@/lib/roadPermit/symbols/normalize';

const line = (id: string, ax: number, ay: number, bx: number, by: number, layer: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0): LineEntity => ({
    id,
    kind: 'line',
    layer,
    style: DEFAULT_STYLE,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
});

describe('幾何計算（geometry）', () => {
    it('距離・極座標・角度', () => {
        expect(distance({ x: 0, y: 0 }, { x: 3000, y: 4000 })).toBe(5000);
        const v = polar(1000, 90);
        expect(v.x).toBeCloseTo(0, 6);
        expect(v.y).toBeCloseTo(1000, 6);
    });

    it('Shift の水平・垂直固定は近い方へ', () => {
        expect(orthoSnap({ x: 0, y: 0 }, { x: 1000, y: 100 })).toEqual({ x: 1000, y: 0 });
        expect(orthoSnap({ x: 0, y: 0 }, { x: 100, y: 1000 })).toEqual({ x: 0, y: 1000 });
    });

    it('回転・反転', () => {
        const r = rotatePoint({ x: 1000, y: 0 }, { x: 0, y: 0 }, 90);
        expect(r.x).toBeCloseTo(0, 6);
        expect(r.y).toBeCloseTo(1000, 6);
        // x 軸で反転 → y が反転
        const m = mirrorPoint({ x: 500, y: 300 }, { x: 0, y: 0 }, { x: 1000, y: 0 });
        expect(m.x).toBeCloseTo(500, 6);
        expect(m.y).toBeCloseTo(-300, 6);
    });

    it('線分の交点（内側だけ）', () => {
        expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 5 });
        expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBeNull();
        // 平行
        expect(segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
    });

    it('面積（靴ひも）と m² 換算: 11.1m × 0.81m = 8.991㎡（西条の申請の数量）', () => {
        const area = polygonArea([
            { x: 0, y: 0 },
            { x: 11100, y: 0 },
            { x: 11100, y: 810 },
            { x: 0, y: 810 },
        ]);
        expect(mm2ToM2(area)).toBe(8.991);
        expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
    });

    it('折れ線の長さ・点の内外', () => {
        const sq = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
        ];
        expect(polylineLength(sq, true)).toBe(400);
        expect(polylineLength(sq, false)).toBe(300);
        expect(pointInPolygon({ x: 50, y: 50 }, sq)).toBe(true);
        expect(pointInPolygon({ x: 150, y: 50 }, sq)).toBe(false);
    });

    it('円弧の点列は始点と終点を含む', () => {
        const pts = arcPoints({ center: { x: 0, y: 0 }, r: 100, startDeg: 0, endDeg: 90 });
        expect(pts[0].x).toBeCloseTo(100, 6);
        expect(pts[pts.length - 1].y).toBeCloseTo(100, 6);
    });

    it('寸法: 寸法線の位置・値・表記', () => {
        const dim = { a: { x: 0, y: 0 }, b: { x: 11100, y: 0 }, offsetMm: -800, mode: 'horizontal' as const, textOverride: null };
        const { p1, p2 } = dimensionLinePoints(dim);
        expect(p1).toEqual({ x: 0, y: -800 });
        expect(p2).toEqual({ x: 11100, y: -800 });
        expect(dimensionValue(dim)).toBe(11100);
        expect(dimensionLabel(dim)).toBe('11,100');
        expect(dimensionLabel({ ...dim, textOverride: '約11.1m' })).toBe('約11.1m');
        // 斜め
        const al = { a: { x: 0, y: 0 }, b: { x: 3000, y: 4000 }, offsetMm: 0, mode: 'aligned' as const, textOverride: null };
        expect(dimensionValue(al)).toBe(5000);
    });

    it('読取点: 端点 > 交点 > 中点 の優先・許容距離の外は null', () => {
        const ents: DrawingEntity[] = [
            line('a', 0, 0, 10000, 0),
            line('b', 5000, -1000, 5000, 1000),
            line('c', 0, 5000, 2000, 5000),
        ];
        // 交点 (5000,0) のすぐ近く（a と b の中点でもあるが、交点が優先）
        const c = snapCandidate({ x: 5010, y: 5 }, ents, 300);
        expect(c?.kind).toBe('intersection');
        expect(c?.p).toEqual({ x: 5000, y: 0 });
        // 端点の近く
        expect(snapCandidate({ x: 20, y: 30 }, ents, 300)?.kind).toBe('end');
        // c の中点 (1000,5000) の近く（端点・交点は遠い）
        const m = snapCandidate({ x: 1010, y: 5005 }, ents, 300);
        expect(m?.kind).toBe('mid');
        expect(m?.p).toEqual({ x: 1000, y: 5000 });
        expect(snapCandidate({ x: 2500, y: 2500 }, ents, 300)).toBeNull();
    });

    it('クリックで選ぶ・範囲で選ぶ', () => {
        const a = line('a', 0, 0, 10000, 0);
        const b = line('b', 0, 5000, 10000, 5000);
        expect(pickEntity({ x: 5000, y: 50 }, [a, b], 200)?.id).toBe('a');
        expect(pickEntity({ x: 5000, y: 2500 }, [a, b], 200)).toBeNull();
        const inRect = entitiesInRect({ minX: -1, minY: -1, maxX: 10001, maxY: 100 }, [a, b]);
        expect(inRect.map((e) => e.id)).toEqual(['a']);
        expect(entityBBox(b)).toEqual({ minX: 0, minY: 5000, maxX: 10000, maxY: 5000 });
    });

    it('移動・回転・反転は図形の種類ごとに正しく写す', () => {
        const a = line('a', 0, 0, 1000, 0);
        expect(translateEntity(a, { x: 10, y: 20 })).toMatchObject({ a: { x: 10, y: 20 }, b: { x: 1010, y: 20 } });
        const r = rotateEntity(a, { x: 0, y: 0 }, 90) as LineEntity;
        expect(r.b.x).toBeCloseTo(0, 6);
        expect(r.b.y).toBeCloseTo(1000, 6);
        const txt: DrawingEntity = { id: 't', kind: 'text', layer: 5, style: DEFAULT_STYLE, at: { x: 0, y: 0 }, text: 'x', heightPaperMm: 3, rotationDeg: 10, align: 'left' };
        expect((rotateEntity(txt, { x: 0, y: 0 }, 30) as typeof txt).rotationDeg).toBe(40);
        const m = mirrorEntity(a, { x: 500, y: -1 }, { x: 500, y: 1 }) as LineEntity;
        expect(m.a.x).toBeCloseTo(1000, 6);
        expect(m.b.x).toBeCloseTo(0, 6);
    });

    it('2線: 幅 6000 の道路は中心線の両側 3000 に 2 本', () => {
        const { left, right } = doubleLine({ x: 0, y: 0 }, { x: 10000, y: 0 }, 6000);
        expect(left[0]).toEqual({ x: 0, y: 3000 });
        expect(right[1]).toEqual({ x: 10000, y: -3000 });
    });

    it('ハッチの斜線は多角形の内側だけ', () => {
        const sq = [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 1000 },
            { x: 0, y: 1000 },
        ];
        const segs = hatchLines(sq, 200, 45);
        expect(segs.length).toBeGreaterThan(3);
        for (const [p, q] of segs) {
            for (const pt of [p, q]) {
                expect(pt.x).toBeGreaterThanOrEqual(-1e-6);
                expect(pt.x).toBeLessThanOrEqual(1000 + 1e-6);
                expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
                expect(pt.y).toBeLessThanOrEqual(1000 + 1e-6);
            }
        }
        expect(hatchLines(sq, 0)).toEqual([]);
    });
});

describe('用紙と座標変換（paper）', () => {
    it('A3 横は 420×297・縦は 297×420', () => {
        expect(paperSizeMm('A3', 'landscape')).toEqual({ w: 420, h: 297 });
        expect(paperSizeMm('A4', 'portrait')).toEqual({ w: 210, h: 297 });
    });

    it('実寸 ↔ 用紙 ↔ pt（S=1/100・原点 (−1000,−2000)）', () => {
        const d = { scale: 100 as const, origin: { x: -1000, y: -2000 }, paper: { size: 'A3' as const, orientation: 'landscape' as const } };
        const paper = toPaper({ x: 9000, y: 8000 }, d);
        expect(paper).toEqual({ x: 100, y: 100 });
        expect(fromPaper(paper, d)).toEqual({ x: 9000, y: 8000 });
        // pt は Y 下向き（用紙の高さ 297 から引く）
        const pt = toPt({ x: 9000, y: 8000 }, d);
        expect(pt.x).toBeCloseTo(100 * PT_PER_MM, 6);
        expect(pt.y).toBeCloseTo((297 - 100) * PT_PER_MM, 6);
        expect(paperToPt({ x: 0, y: 297 }, 297)).toEqual({ x: 0, y: 0 });
    });

    it('originToFit: 図形の範囲を用紙の中央に収める', () => {
        const d = { scale: 100 as const, paper: { size: 'A3' as const, orientation: 'landscape' as const } };
        const o = originToFit({ minX: 0, minY: 0, maxX: 20000, maxY: 10000 }, d);
        // 内側 400×277mm = 40000×27700mm（実寸）。20000×10000 を中央に置く
        expect(o.x).toBeCloseTo(0 - 1000 - 10000, 6);
        expect(o.y).toBeCloseTo(0 - 1000 - 8850, 6);
    });
});

describe('既定値と正規化（defaults）', () => {
    it('空の図面は A3 横・1/100・レイヤ 7 枚（下敷きだけ印刷しない）', () => {
        const d = emptyRoadPermitDrawing();
        expect(d.paper).toEqual({ size: 'A3', orientation: 'landscape' });
        expect(d.scale).toBe(100);
        expect(d.layers).toHaveLength(7);
        expect(d.layers[6].printable).toBe(false);
        expect(isDrawingEmpty(d)).toBe(true);
        expect(isDrawingEmpty(null)).toBe(true);
    });

    it('壊れた図形は落とし、欠けた欄は既定で埋める。id の重複は付け直す', () => {
        const raw = {
            version: 1,
            paper: { size: 'A4', orientation: 'portrait' },
            scale: 999,
            origin: { x: 1, y: 2 },
            layers: [{ id: 2, visible: false, locked: true }],
            currentLayer: 3,
            entities: [
                { id: 'a', kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
                { id: 'a', kind: 'line', a: { x: 0, y: 0 }, b: { x: 2, y: 2 }, style: { lineType: 'dashed', color: 'red' } },
                { kind: 'circle', center: { x: 0, y: 0 }, r: 0 },
                { kind: 'polyline', points: [{ x: 0, y: 0 }] },
                { kind: 'text', at: { x: 0, y: 0 }, text: 'hello' },
                { kind: 'unknown' },
            ],
        };
        const d = normalizeRoadPermitDrawing(raw);
        expect(d.paper).toEqual({ size: 'A4', orientation: 'portrait' });
        expect(d.scale).toBe(100); // 999 は既定へ
        expect(d.layers[2]).toMatchObject({ visible: false, locked: true, printable: true, name: '足場・養生' });
        expect(d.currentLayer).toBe(3);
        expect(d.entities).toHaveLength(3);
        expect(d.entities[0].id).toBe('a');
        expect(d.entities[1].id).not.toBe('a');
        expect(d.entities[1].style).toEqual({ lineType: 'dashed', width: 'normal', color: '#000000' });
        expect(d.entities[2]).toMatchObject({ kind: 'text', heightPaperMm: 3, align: 'left', rotationDeg: 0 });
        expect(isDrawingEmpty(d)).toBe(false);
    });

    it('normalizeEntity: 矩形は閉じた連続線として持てる', () => {
        const e = normalizeEntity({
            kind: 'polyline',
            closed: true,
            layer: 1,
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
            ],
        }) as PolylineEntity;
        expect(e.kind).toBe('polyline');
        expect(e.closed).toBe(true);
        expect(e.layer).toBe(1);
        expect(e.id).toBeTruthy();
    });

    it('null や文字列を渡しても空の図面になる', () => {
        expect(normalizeRoadPermitDrawing(null).entities).toEqual([]);
        expect(normalizeRoadPermitDrawing('x').scale).toBe(100);
    });
});

describe('記号（Phase 2b）の当たり判定と範囲（symbols を渡したとき）', () => {
    // 1,500×97 の長方形（コーンバー風）を中心に置いた記号
    const bar: RoadPermitSymbolDto = {
        id: 'bar',
        name: 'コーンバー',
        category: 'cone',
        countLabel: '',
        countUnit: '',
        countNote: '',
        geometry: { lines: [-750, -48.5, 750, -48.5, 750, -48.5, 750, 48.5, 750, 48.5, -750, 48.5, -750, 48.5, -750, -48.5], circles: [], arcs: [], polylines: [] },
        lengthMm: 1500,
        widthMm: 97,
        barPitchMm: 1403,
        sourceFile: '',
        sourceBlock: '',
        sourceNote: '',
        sortOrder: 0,
        isActive: true,
        createdAt: '',
        updatedAt: '',
    };
    const symbols = toSymbolMap([bar]);
    const sym = (rotationDeg: number, symbolId = 'bar'): SymbolEntity => ({
        id: 's1',
        kind: 'symbol',
        layer: 3,
        style: DEFAULT_STYLE,
        symbolId,
        at: { x: 10000, y: 0 },
        rotationDeg,
        mirrored: false,
    });

    it('entityBBox: 置いた形の範囲（90 度回すと縦長）', () => {
        const b0 = entityBBox(sym(0), symbols);
        expect(b0.minX).toBeCloseTo(9250);
        expect(b0.maxX).toBeCloseTo(10750);
        expect(b0.maxY).toBeCloseTo(48.5);
        const b90 = entityBBox(sym(90), symbols);
        expect(b90.minY).toBeCloseTo(-750);
        expect(b90.maxY).toBeCloseTo(750);
        expect(b90.maxX).toBeCloseTo(10048.5);
    });

    it('pickEntity: 記号の線に当たる（中心から離れた端の線でも選べる）', () => {
        // 右端の線（x=10,750）の近く。中心からは 700mm 以上離れている
        expect(pickEntity({ x: 10740, y: 0 }, [sym(0)], 30, symbols)?.id).toBe('s1');
        // 記号の外
        expect(pickEntity({ x: 10000, y: 500 }, [sym(0)], 30, symbols)).toBeNull();
    });

    it('entitiesInRect・読取点（中心と 4 隅）', () => {
        expect(entitiesInRect({ minX: 9000, minY: -100, maxX: 11000, maxY: 100 }, [sym(0)], symbols)).toHaveLength(1);
        expect(entitiesInRect({ minX: 9500, minY: -100, maxX: 11000, maxY: 100 }, [sym(0)], symbols)).toHaveLength(0);
        const c = snapCandidate({ x: 10745, y: 45 }, [sym(0)], 20, symbols);
        expect(c?.kind).toBe('end');
        expect(c?.p.x).toBeCloseTo(10750);
        expect(c?.p.y).toBeCloseTo(48.5);
        expect(snapCandidate({ x: 10005, y: 0 }, [sym(0)], 20, symbols)?.kind).toBe('center');
    });

    it('symbols を渡さないとき・表に無い記号は今までどおり（基準点のまわり 100mm の四角）', () => {
        expect(entityBBox(sym(0))).toEqual({ minX: 9900, minY: -100, maxX: 10100, maxY: 100 });
        expect(entityBBox(sym(0, 'none'), symbols)).toEqual({ minX: 9900, minY: -100, maxX: 10100, maxY: 100 });
        expect(pickEntity({ x: 10740, y: 0 }, [sym(0)], 30)).toBeNull();
        expect(pickEntity({ x: 10010, y: 0 }, [sym(0)], 30)?.id).toBe('s1');
    });
});
