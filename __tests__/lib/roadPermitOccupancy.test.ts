/**
 * 道路申請 Phase 2b: 占用範囲の面積と式（lib/roadPermit/drawing/occupancy.ts）。
 * 西条市の過去の値 11.1×0.81＝8.991㎡ で確かめる。
 */
import {
    isRectangle,
    occupancyApplyItems,
    occupancyFormPatch,
    occupancyLabel,
    occupancyLabelPoint,
    occupancyMeasure,
    occupancyTotalM2,
} from '@/lib/roadPermit/drawing/occupancy';
import { rotatePoint } from '@/lib/roadPermit/drawing/geometry';
import type { DrawingPoint, OccupancyEntity } from '@/types/roadPermitDrawing';
import { DEFAULT_STYLE } from '@/lib/roadPermit/drawing/defaults';

const rect = (x1: number, y1: number, x2: number, y2: number): DrawingPoint[] => [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
];
const occ = (points: DrawingPoint[], routeName = '', id = 'o1'): OccupancyEntity => ({
    id,
    kind: 'occupancy',
    layer: 2,
    style: DEFAULT_STYLE,
    points,
    routeName,
});

describe('occupancyMeasure（面積と式）', () => {
    it('長方形 11,100×810 → 0.81×11.10＝8.991㎡（出幅×延長）', () => {
        const m = occupancyMeasure(rect(9000, -810, 20100, 0));
        expect(m.kind).toBe('rect');
        expect(m.areaM2).toBe(8.991);
        expect(m.lengthM).toBeCloseTo(11.1);
        expect(m.widthM).toBeCloseTo(0.81);
        expect(m.expression).toBe('0.81×11.10＝8.991㎡');
    });

    it('回転した長方形も長方形と判定する（30 度・閉じる点が重なっていても）', () => {
        const pts = rect(0, 0, 11100, 810).map((p) => rotatePoint(p, { x: 0, y: 0 }, 30));
        expect(isRectangle(pts)).toBe(true);
        const m = occupancyMeasure([...pts, pts[0]]);
        expect(m.kind).toBe('rect');
        expect(m.expression).toBe('0.81×11.10＝8.991㎡');
    });

    it('三角形 → 高さ×底辺÷2（底辺＝いちばん長い辺）', () => {
        // 底辺 10,080・高さ 1,531 → 7.71624㎡
        const m = occupancyMeasure([
            { x: 0, y: 0 },
            { x: 10080, y: 0 },
            { x: 3000, y: 1531 },
        ]);
        expect(m.kind).toBe('triangle');
        expect(m.areaM2).toBe(7.716);
        expect(m.lengthM).toBeCloseTo(10.08);
        expect(m.widthM).toBeCloseTo(1.531);
        expect(m.expression).toBe('1.53×10.08÷2＝7.716㎡');
    });

    it('その他（台形）→ 面積（出幅 ○・延長 ○）。延長＝いちばん長い辺・出幅＝面積÷延長', () => {
        // 下底 10,080・上底 5,352・高さ 1,000 → 7.716㎡・出幅 7.716/10.08＝0.765…
        const m = occupancyMeasure([
            { x: 0, y: 0 },
            { x: 10080, y: 0 },
            { x: 7352, y: 1000 },
            { x: 2000, y: 1000 },
        ]);
        expect(m.kind).toBe('other');
        expect(m.areaM2).toBe(7.716);
        expect(m.expression).toBe('7.716㎡（出幅 0.77・延長 10.08）');
    });

    it('角が直角でない平行四辺形は長方形にしない', () => {
        const pts = [
            { x: 0, y: 0 },
            { x: 10000, y: 0 },
            { x: 10500, y: 800 },
            { x: 500, y: 800 },
        ];
        expect(isRectangle(pts)).toBe(false);
        expect(occupancyMeasure(pts).kind).toBe('other');
    });

    it('点が足りない・面積 0 は 0㎡', () => {
        expect(occupancyMeasure([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toMatchObject({ areaM2: 0, kind: 'other' });
    });
});

describe('占用範囲の文字と申請書への入れ方', () => {
    it('文字: 路線名があれば頭に付ける', () => {
        expect(occupancyLabel(occ(rect(0, 0, 11100, 810)))).toBe('占用 8.991㎡');
        expect(occupancyLabel(occ(rect(0, 0, 11100, 810), '市道 新屋敷線'))).toBe('市道 新屋敷線 占用 8.991㎡');
    });

    it('文字の位置は重心', () => {
        const c = occupancyLabelPoint(rect(0, 0, 11100, 810));
        expect(c.x).toBeCloseTo(5550);
        expect(c.y).toBeCloseTo(405);
    });

    it('1 つ: 長さ＝延長・幅＝出幅・数量＝面積・規模の文言は空', () => {
        const items = occupancyApplyItems([occ(rect(0, 0, 11100, 810), '市道 新屋敷線')]);
        expect(occupancyFormPatch(items)).toEqual({ length: '11.10', width: '0.81', quantity: '8.991', scaleNote: '' });
    });

    it('2 つ以上: 規模の文言に路線ごと・数量は合計・長さと幅は空（路線名が空なら「占用範囲 n」）', () => {
        const items = occupancyApplyItems([occ(rect(0, 0, 11100, 810), '市道 新屋敷線', 'a'), occ(rect(0, 0, 5000, 1000), '', 'b')]);
        expect(occupancyTotalM2(items)).toBe(13.991);
        expect(occupancyFormPatch(items)).toEqual({
            length: '',
            width: '',
            quantity: '13.991',
            scaleNote: '市道 新屋敷線 8.991㎡／占用範囲 2 5.000㎡',
        });
    });

    it('0 件なら null', () => {
        expect(occupancyFormPatch([])).toBeNull();
    });
});
