/**
 * 道路申請 Phase 2b: 記号を数える（数量の文・凡例）。lib/roadPermit/symbols/counting.ts
 */
import {
    countSymbols,
    legendLayout,
    legendRows,
    legendVisibleRows,
    symbolCountText,
    LEGEND_MAX_ROWS,
} from '@/lib/roadPermit/symbols/counting';
import { toSymbolMap } from '@/lib/roadPermit/symbols/normalize';
import { DEFAULT_STYLE, defaultLayers } from '@/lib/roadPermit/drawing/defaults';
import type { DrawingEntity, DrawingLayerId, SymbolEntity } from '@/types/roadPermitDrawing';
import type { RoadPermitSymbolCategory, RoadPermitSymbolDto } from '@/types/roadPermitSymbol';

const square = { lines: [-100, -100, 100, -100, 100, -100, 100, 100], circles: [], arcs: [], polylines: [] };

function symbol(
    id: string,
    category: RoadPermitSymbolCategory,
    count: { label: string; unit: string; note?: string },
    sortOrder = 0,
    name = id,
): RoadPermitSymbolDto {
    return {
        id,
        name,
        category,
        countLabel: count.label,
        countUnit: count.unit,
        countNote: count.note ?? '',
        geometry: square,
        lengthMm: 200,
        widthMm: 200,
        barPitchMm: null,
        sourceFile: '',
        sourceBlock: '',
        sourceNote: '',
        sortOrder,
        isActive: true,
        createdAt: '',
        updatedAt: '',
    };
}

let n = 0;
const place = (symbolId: string, times = 1, layer: DrawingLayerId = 3): SymbolEntity[] =>
    Array.from({ length: times }, () => ({
        id: `e${++n}`,
        kind: 'symbol' as const,
        layer,
        style: DEFAULT_STYLE,
        symbolId,
        at: { x: n * 1000, y: 0 },
        rotationDeg: 0,
        mirrored: false,
    }));

const cone = symbol('cone', 'cone', { label: 'カラーコーン', unit: '個' }, 0, 'カラーコーン');
const bar = symbol('bar', 'cone', { label: 'コーンバー', unit: '本', note: '1.5m' }, 1, 'コーンバー1500p');
const truck = symbol('truck', 'vehicle', { label: 'トラック', unit: '台' }, 0, '2t トラック');
const truck4 = symbol('truck4', 'vehicle', { label: 'トラック', unit: '台' }, 1, '4t トラック');
const guard = symbol('guard', 'person', { label: '誘導員', unit: '人' }, 0, '誘導員');
const mark = symbol('mark', 'road', { label: '', unit: '' }, 0, '矢印');
const symbols = toSymbolMap([cone, bar, truck, truck4, guard, mark]);

describe('countSymbols・symbolCountText（数量の文）', () => {
    it('「カラーコーン 11個・コーンバー 10本（1.5m）・トラック 1台・誘導員 2人」（並びは分類→並び順）', () => {
        const entities: DrawingEntity[] = [...place('guard', 2), ...place('truck'), ...place('bar', 10), ...place('cone', 11)];
        const rows = countSymbols(entities, symbols);
        expect(rows.map((r) => [r.countLabel, r.count])).toEqual([
            ['カラーコーン', 11],
            ['コーンバー', 10],
            ['トラック', 1],
            ['誘導員', 2],
        ]);
        expect(symbolCountText(rows)).toBe('カラーコーン 11個・コーンバー 10本（1.5m）・トラック 1台・誘導員 2人');
    });

    it('countLabel＋countNote が同じものはまとめる・countLabel が空の記号は数えない・表に無い記号は数えない', () => {
        const entities: DrawingEntity[] = [...place('truck', 2), ...place('truck4', 3), ...place('mark', 4), ...place('nothing', 5)];
        const rows = countSymbols(entities, symbols);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ countLabel: 'トラック', count: 5, countUnit: '台', symbolId: 'truck' });
        expect(symbolCountText(rows)).toBe('トラック 5台');
    });

    it('印刷しないレイヤ（下敷き・見えないレイヤ）の記号は数えない', () => {
        const layers = defaultLayers().map((l) => (l.id === 4 ? { ...l, visible: false } : l));
        const entities: DrawingEntity[] = [...place('cone', 3, 3), ...place('cone', 2, 6), ...place('truck', 1, 4)];
        expect(symbolCountText(countSymbols(entities, symbols, layers))).toBe('カラーコーン 3個');
        // layers を渡さなければ全部数える
        expect(symbolCountText(countSymbols(entities, symbols))).toBe('カラーコーン 5個・トラック 1台');
    });

    it('記号が無ければ空の文', () => {
        expect(symbolCountText(countSymbols([], symbols))).toBe('');
        expect(symbolCountText(countSymbols(place('mark', 2), symbols))).toBe('');
    });
});

describe('legendRows（凡例）', () => {
    it('記号ごとに名前と数（countLabel が空でも名前で出す・同じ記号はまとめる・単位が空なら「個」）', () => {
        const entities: DrawingEntity[] = [...place('mark', 2), ...place('truck4'), ...place('truck', 2), ...place('cone', 3)];
        const rows = legendRows(entities, symbols, defaultLayers());
        expect(rows.map((r) => [r.name, r.count, r.unit])).toEqual([
            ['カラーコーン', 3, '個'],
            ['2t トラック', 2, '台'],
            ['4t トラック', 1, '台'],
            ['矢印', 2, '個'],
        ]);
        expect(rows[0].geometry).toBe(square);
    });

    it('12 行を超えたら 11 行＋「ほか n 種」', () => {
        const many = Array.from({ length: 15 }, (_, i) => symbol(`s${i}`, 'other', { label: '', unit: '' }, i));
        const map = toSymbolMap(many);
        const rows = legendRows(many.flatMap((s) => place(s.id)), map);
        expect(rows).toHaveLength(15);
        const v = legendVisibleRows(rows);
        expect(v.rows).toHaveLength(LEGEND_MAX_ROWS - 1);
        expect(v.more).toBe(4);
        expect(legendVisibleRows(rows.slice(0, 12))).toMatchObject({ more: 0 });
    });

    it('行が多いほど行の高さと文字を小さくする（下絵は 8mm 角まで）', () => {
        const few = legendLayout(3);
        const lots = legendLayout(12);
        expect(few.thumbMm).toBe(8);
        expect(lots.rowMm).toBeLessThan(few.rowMm);
        expect(lots.fontMm).toBeLessThan(few.fontMm);
        expect(few.heightMm).toBeCloseTo(few.headerMm + few.rowMm * 3);
    });
});
