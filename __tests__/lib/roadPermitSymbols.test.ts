/**
 * 道路申請の記号（Phase 2b）の土台: 形の幾何計算・置き方（反転→回転→移動）・正規化・JWW のブロック名の掃除・
 * コーンバーの初期値・並び順・下絵の path。
 */
import {
    centerSymbolGeometry,
    emptySymbolGeometry,
    isSymbolGeometryEmpty,
    placePoint,
    placedSymbolBBox,
    placedSymbolCorners,
    placedSymbolSegments,
    scaleSymbolGeometry,
    symbolBBox,
    symbolPolylines,
    symbolPrimitiveCount,
    translateSymbolGeometry,
} from '@/lib/roadPermit/symbols/geometry';
import {
    ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES,
    cleanJwwBlockName,
    defaultBarCountNote,
    defaultBarPitchMm,
    formatSymbolSize,
    isConeBarSymbol,
    isMarkerBlockName,
    normalizeRoadPermitSymbolCategory,
    normalizeRoadPermitSymbolGeometry,
    sortRoadPermitSymbols,
    toSymbolMap,
} from '@/lib/roadPermit/symbols/normalize';
import { symbolThumbnailPath } from '@/components/RoadPermits/Drawing/SymbolThumbnail';
import type { RoadPermitSymbolDto, RoadPermitSymbolGeometry } from '@/types/roadPermitSymbol';

const deg = (d: number) => (d * Math.PI) / 180;

/** 原点中心の正方形（1 辺 2×half）を 4 本の線で */
const square = (half: number): RoadPermitSymbolGeometry => ({
    lines: [-half, -half, half, -half, half, -half, half, half, half, half, -half, half, -half, half, -half, -half],
    circles: [],
    arcs: [],
    polylines: [],
});

/** 横長の長方形（コーンバー 1,500×97 のつもり。左下 (x0,y0)） */
const rect = (x0: number, y0: number, w: number, h: number): RoadPermitSymbolGeometry => ({
    lines: [x0, y0, x0 + w, y0, x0 + w, y0, x0 + w, y0 + h, x0 + w, y0 + h, x0, y0 + h, x0, y0 + h, x0, y0],
    circles: [],
    arcs: [],
    polylines: [],
});

describe('記号の形の幾何計算（lib/roadPermit/symbols/geometry）', () => {
    it('線・円・円弧・連続線の区間を数える', () => {
        const g: RoadPermitSymbolGeometry = { lines: [0, 0, 1, 0, 0, 0, 0, 1], circles: [0, 0, 5], arcs: [0, 0, 5, 0, 90], polylines: [[0, 0, 1, 1, 2, 2]] };
        expect(symbolPrimitiveCount(g)).toBe(2 + 1 + 1 + 2);
        expect(isSymbolGeometryEmpty(g)).toBe(false);
        expect(isSymbolGeometryEmpty(emptySymbolGeometry())).toBe(true);
    });

    it('点列: 線は 2 点・円は閉じる・円弧は範囲だけ・連続線はそのまま', () => {
        const g: RoadPermitSymbolGeometry = { lines: [0, 0, 10, 0], circles: [0, 0, 1], arcs: [0, 0, 1, 0, 90], polylines: [[0, 0, 1, 1, 2, 0]] };
        const polys = symbolPolylines(g);
        expect(polys).toHaveLength(4);
        expect(polys[0]).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
        const circle = polys[1];
        expect(circle[0].x).toBeCloseTo(circle[circle.length - 1].x, 6);
        expect(circle[0].y).toBeCloseTo(circle[circle.length - 1].y, 6);
        const arc = polys[2];
        expect(arc[0]).toEqual({ x: 1, y: 0 });
        expect(arc[arc.length - 1].x).toBeCloseTo(0, 6);
        expect(arc[arc.length - 1].y).toBeCloseTo(1, 6);
        expect(polys[3]).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]);
    });

    it('外形は円弧の実際の範囲だけで測る（円全体にしない）', () => {
        // 半径 10,000 の円弧 0〜10 度。円全体で測ると 20,000×20,000 になってしまう
        const g: RoadPermitSymbolGeometry = { lines: [], circles: [], arcs: [0, 0, 10000, 0, 10], polylines: [] };
        const bb = symbolBBox(g);
        expect(bb.minX).toBeCloseTo(10000 * Math.cos(deg(10)), 0);
        expect(bb.maxX).toBeCloseTo(10000, 0);
        expect(bb.minY).toBeCloseTo(0, 0);
        expect(bb.maxY).toBeCloseTo(10000 * Math.sin(deg(10)), 0);
    });

    it('円は直径で測る', () => {
        const bb = symbolBBox({ lines: [], circles: [100, 50, 20], arcs: [], polylines: [] });
        expect(bb.minX).toBeCloseTo(80, 0);
        expect(bb.maxX).toBeCloseTo(120, 0);
        expect(bb.minY).toBeCloseTo(30, 0);
        expect(bb.maxY).toBeCloseTo(70, 0);
    });

    it('中心を原点にそろえ、大きさ（長さ＝横・幅＝縦）を出す', () => {
        const { geometry, lengthMm, widthMm } = centerSymbolGeometry(rect(100, 200, 1500, 97));
        expect(lengthMm).toBeCloseTo(1500, 6);
        expect(widthMm).toBeCloseTo(97, 6);
        const bb = symbolBBox(geometry);
        expect(bb.minX).toBeCloseTo(-750, 6);
        expect(bb.maxX).toBeCloseTo(750, 6);
        expect(bb.minY).toBeCloseTo(-48.5, 6);
        expect(bb.maxY).toBeCloseTo(48.5, 6);
    });

    it('平行移動と倍率（倍率は円の半径にも掛かる）', () => {
        const moved = translateSymbolGeometry({ lines: [0, 0, 1, 1], circles: [0, 0, 2], arcs: [0, 0, 3, 0, 90], polylines: [[0, 0, 1, 0]] }, 10, 20);
        expect(moved).toEqual({ lines: [10, 20, 11, 21], circles: [10, 20, 2], arcs: [10, 20, 3, 0, 90], polylines: [[10, 20, 11, 20]] });
        const scaled = scaleSymbolGeometry(square(1), 20);
        const bb = symbolBBox(scaled);
        expect(bb.minX).toBeCloseTo(-20, 6);
        expect(bb.maxX).toBeCloseTo(20, 6);
        expect(scaleSymbolGeometry({ lines: [], circles: [1, 1, 2], arcs: [], polylines: [] }, 20).circles).toEqual([20, 20, 40]);
    });

    it('置く: 移動・回転（反時計回り）・反転（X を −X）', () => {
        const p = { x: 1, y: 0 };
        expect(placePoint(p, { at: { x: 10, y: 20 }, rotationDeg: 0, mirrored: false })).toEqual({ x: 11, y: 20 });
        const r = placePoint(p, { at: { x: 0, y: 0 }, rotationDeg: 90, mirrored: false });
        expect(r.x).toBeCloseTo(0, 9);
        expect(r.y).toBeCloseTo(1, 9);
        expect(placePoint(p, { at: { x: 0, y: 0 }, rotationDeg: 0, mirrored: true })).toEqual({ x: -1, y: 0 });
        // 反転してから回転する: (1,0) → 反転 (−1,0) → 90 度回して (0,−1)
        const m = placePoint(p, { at: { x: 0, y: 0 }, rotationDeg: 90, mirrored: true });
        expect(m.x).toBeCloseTo(0, 9);
        expect(m.y).toBeCloseTo(-1, 9);
    });

    it('置いた記号の外接の範囲・線分・4 隅', () => {
        const bar = centerSymbolGeometry(rect(0, 0, 1500, 97)).geometry;
        const pl = { at: { x: 1000, y: 1000 }, rotationDeg: 90, mirrored: false };
        const bb = placedSymbolBBox(bar, pl);
        expect(bb.minX).toBeCloseTo(1000 - 48.5, 6);
        expect(bb.maxX).toBeCloseTo(1000 + 48.5, 6);
        expect(bb.minY).toBeCloseTo(1000 - 750, 6);
        expect(bb.maxY).toBeCloseTo(1000 + 750, 6);
        expect(placedSymbolSegments(bar, pl)).toHaveLength(4);
        const corners = placedSymbolCorners(square(100), { at: { x: 0, y: 0 }, rotationDeg: 45, mirrored: false });
        expect(corners).toHaveLength(4);
        const top = corners.reduce((a, b) => (b.y > a.y ? b : a));
        expect(top.x).toBeCloseTo(0, 6);
        expect(top.y).toBeCloseTo(100 * Math.SQRT2, 6);
    });
});

describe('記号の正規化（lib/roadPermit/symbols/normalize）', () => {
    it('壊れた JSON でも落ちない。数でない区切りは落とし、区切りの途中で終わる分も落とす', () => {
        const g = normalizeRoadPermitSymbolGeometry({
            lines: [0, 0, 1, 'x', 0, 0, 2, 2, 5],
            circles: [0, 0, 1, 9],
            arcs: null,
            polylines: [[0, 0, 1, 1, 2], [0, 0], 'x', [3, 3, 4, 4]],
        });
        expect(g).toEqual({ lines: [0, 0, 2, 2], circles: [0, 0, 1], arcs: [], polylines: [[0, 0, 1, 1], [3, 3, 4, 4]] });
        expect(normalizeRoadPermitSymbolGeometry(null)).toEqual({ lines: [], circles: [], arcs: [], polylines: [] });
        expect(normalizeRoadPermitSymbolGeometry('x')).toEqual({ lines: [], circles: [], arcs: [], polylines: [] });
    });

    it('上限（5,000）を超える分は落とす', () => {
        const lines: number[] = [];
        for (let i = 0; i < ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES + 10; i++) lines.push(i, 0, i, 1);
        const g = normalizeRoadPermitSymbolGeometry({ lines, circles: [0, 0, 1], arcs: [], polylines: [[0, 0, 1, 1]] });
        expect(g.lines).toHaveLength(ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES * 4);
        expect(g.circles).toEqual([]);
        expect(g.polylines).toEqual([]);
        expect(symbolPrimitiveCount(g)).toBe(ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES);
    });

    it('分類は知らない値なら other', () => {
        expect(normalizeRoadPermitSymbolCategory('cone')).toBe('cone');
        expect(normalizeRoadPermitSymbolCategory('truck')).toBe('other');
        expect(normalizeRoadPermitSymbolCategory(undefined)).toBe('other');
    });

    it('JWW のブロック名の掃除（「（CAD素材.com）」はどこにあっても外す・末尾の印を外す）', () => {
        expect(cleanJwwBlockName('コーンバー1500p（CAD素材.com）@@SfigorgFlag@@4')).toBe('コーンバー1500p');
        expect(cleanJwwBlockName('誘導員平面（CAD素材.com）5')).toBe('誘導員平面5');
        expect(cleanJwwBlockName('*U54@@SfigorgFlag@@4')).toBe('*U54');
        expect(cleanJwwBlockName('作業員（CAD素材.com）48ba20bd')).toBe('作業員48ba20bd');
        expect(cleanJwwBlockName('エルフ2t平4(CAD素材.com)')).toBe('エルフ2t平4');
        expect(cleanJwwBlockName('  A型バリケード3  ')).toBe('A型バリケード3');
        // 外すと空になるときは元の名前のまま
        expect(cleanJwwBlockName('（CAD素材.com）')).toBe('（CAD素材.com）');
        expect(isMarkerBlockName('_Origin')).toBe(true);
        expect(isMarkerBlockName('_Small@@SfigorgFlag@@4')).toBe(true);
        expect(isMarkerBlockName('*U54')).toBe(false);
    });

    it('コーンバーの初期値: 間隔＝長さ−幅（整数・最低 1）・添え字＝「1.5m」', () => {
        expect(defaultBarPitchMm(1500, 96.98)).toBe(1403);
        expect(defaultBarPitchMm(2000, 96.98)).toBe(1903);
        expect(defaultBarPitchMm(1200, 96.98)).toBe(1103);
        expect(defaultBarPitchMm(10, 50)).toBe(1);
        expect(defaultBarCountNote(1500)).toBe('1.5m');
        expect(defaultBarCountNote(2000)).toBe('2.0m');
        expect(defaultBarCountNote(1200)).toBe('1.2m');
        expect(isConeBarSymbol({ barPitchMm: 1403 })).toBe(true);
        expect(isConeBarSymbol({ barPitchMm: null })).toBe(false);
        expect(isConeBarSymbol({ barPitchMm: 0 })).toBe(false);
    });

    it('大きさの表記は 長さ×幅・整数・3 桁区切り', () => {
        expect(formatSymbolSize({ lengthMm: 6295.68, widthMm: 2166.03 })).toBe('6,296×2,166');
        expect(formatSymbolSize({ lengthMm: 390, widthMm: 390 })).toBe('390×390');
    });

    it('並び順は 分類の順 → 並び順 → 名前。表は id で引ける', () => {
        const mk = (id: string, category: RoadPermitSymbolDto['category'], sortOrder: number, name: string): RoadPermitSymbolDto => ({
            id,
            name,
            category,
            countLabel: '',
            countUnit: '',
            countNote: '',
            geometry: emptySymbolGeometry(),
            lengthMm: 1,
            widthMm: 1,
            barPitchMm: null,
            sourceFile: '',
            sourceBlock: '',
            sourceNote: '',
            sortOrder,
            isActive: true,
            createdAt: '',
            updatedAt: '',
        });
        const list = [mk('a', 'vehicle', 0, 'トラック'), mk('b', 'cone', 2, 'コーンバー'), mk('c', 'cone', 1, 'カラーコーン'), mk('d', 'cone', 2, 'あ')];
        expect(sortRoadPermitSymbols(list).map((s) => s.id)).toEqual(['c', 'd', 'b', 'a']);
        expect(toSymbolMap(list).get('b')?.name).toBe('コーンバー');
    });
});

describe('下絵の path（SymbolThumbnail）', () => {
    it('形を枠に収めた M/L の並びになる。空の形なら空文字', () => {
        const d = symbolThumbnailPath(square(100), 48, 1500);
        expect(d.startsWith('M')).toBe(true);
        expect(d).toContain('L');
        // 左上の余白（8%）より内側に収まる
        const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
        expect(Math.min(...nums)).toBeGreaterThanOrEqual(48 * 0.08 - 1e-6);
        expect(Math.max(...nums)).toBeLessThanOrEqual(48 * 0.92 + 1e-6);
        expect(symbolThumbnailPath(emptySymbolGeometry(), 48, 1500)).toBe('');
    });

    it('線が多すぎるときは長いものから上限の本数だけ描く', () => {
        const g: RoadPermitSymbolGeometry = { lines: [0, 0, 100, 0, 0, 0, 1, 0, 0, 0, 0, 50], circles: [], arcs: [], polylines: [] };
        const d = symbolThumbnailPath(g, 48, 2);
        expect((d.match(/M/g) ?? []).length).toBe(2);
    });
});
