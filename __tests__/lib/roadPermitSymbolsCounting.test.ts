/**
 * 道路申請 Phase 2b: 記号を数える（「方法又は形態」の文・凡例）。lib/roadPermit/symbols/counting.ts
 * 「方法又は形態」は数を書かない（kei 決定 2026-10-14・docs/指示書_道路申請_許可書を見ての修正.md §2）。数は凡例に出す
 */
import {
    countSymbols,
    legendLayout,
    legendRows,
    legendVisibleRows,
    symbolMethodText,
    SYMBOL_METHOD_SUFFIX,
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

describe('countSymbols・symbolMethodText（「方法又は形態」の文・数は書かない）', () => {
    it('数える: 並びは分類→並び順。文は「カラーコーン・コーンバー設置・トラック駐車・誘導員配置」（数を書かない）', () => {
        const entities: DrawingEntity[] = [...place('guard', 2), ...place('truck'), ...place('bar', 10), ...place('cone', 11)];
        const rows = countSymbols(entities, symbols);
        expect(rows.map((r) => [r.countLabel, r.count, r.category])).toEqual([
            ['カラーコーン', 11, 'cone'],
            ['コーンバー', 10, 'cone'],
            ['トラック', 1, 'vehicle'],
            ['誘導員', 2, 'person'],
        ]);
        expect(symbolMethodText(rows)).toBe('カラーコーン・コーンバー設置・トラック駐車・誘導員配置');
    });

    it('分類ごとの言葉: コーン類・バリケード・路面標示・その他＝設置／車両・クレーン＝駐車／人＝配置。同じ言葉が続けば最後にだけ', () => {
        const extra = toSymbolMap([
            cone,
            symbol('barricade', 'barricade', { label: 'A型バリケード', unit: '台' }),
            symbol('crane', 'crane', { label: 'ユニック車', unit: '台' }),
            symbol('arrow', 'road', { label: '矢印板', unit: '枚' }),
            symbol('misc', 'other', { label: '看板', unit: '枚' }),
            truck,
            guard,
        ]);
        const entities: DrawingEntity[] = [
            ...place('misc'),
            ...place('arrow'),
            ...place('guard'),
            ...place('crane'),
            ...place('truck'),
            ...place('barricade'),
            ...place('cone'),
        ];
        expect(symbolMethodText(countSymbols(entities, extra))).toBe('カラーコーン・A型バリケード設置・トラック・ユニック車駐車・誘導員配置・矢印板・看板設置');
        expect(SYMBOL_METHOD_SUFFIX).toEqual({ cone: '設置', barricade: '設置', road: '設置', other: '設置', vehicle: '駐車', crane: '駐車', person: '配置' });
    });

    it('同じ名前の記号は 1 つにまとめる（countNote が違っても）・countLabel が空の記号は入れない・表に無い記号は入れない', () => {
        const entities: DrawingEntity[] = [...place('truck', 2), ...place('truck4', 3), ...place('mark', 4), ...place('nothing', 5)];
        const rows = countSymbols(entities, symbols);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ countLabel: 'トラック', count: 5, countUnit: '台', symbolId: 'truck' });
        expect(symbolMethodText(rows)).toBe('トラック駐車');
        // コーンバー 1.5m と 2.0m（名前が同じで添え字が違う）は「コーンバー」1 つ
        const bars = toSymbolMap([bar, symbol('bar2', 'cone', { label: 'コーンバー', unit: '本', note: '2.0m' }, 2)]);
        expect(symbolMethodText(countSymbols([...place('bar'), ...place('bar2')], bars))).toBe('コーンバー設置');
    });

    it('印刷しないレイヤ（下敷き・見えないレイヤ）の記号は入れない', () => {
        const layers = defaultLayers().map((l) => (l.id === 4 ? { ...l, visible: false } : l));
        const entities: DrawingEntity[] = [...place('cone', 3, 3), ...place('cone', 2, 6), ...place('truck', 1, 4)];
        expect(symbolMethodText(countSymbols(entities, symbols, layers))).toBe('カラーコーン設置');
        // layers を渡さなければ全部数える
        expect(symbolMethodText(countSymbols(entities, symbols))).toBe('カラーコーン設置・トラック駐車');
    });

    it('記号が無ければ空の文', () => {
        expect(symbolMethodText(countSymbols([], symbols))).toBe('');
        expect(symbolMethodText(countSymbols(place('mark', 2), symbols))).toBe('');
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
