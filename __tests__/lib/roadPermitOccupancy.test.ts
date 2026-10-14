/**
 * 道路申請: 占用範囲の面積と式（lib/roadPermit/drawing/occupancy.ts）。
 * 許可が出た図面の数（docs/指示書_道路申請_許可書を見ての修正.md §1.4。お客様の情報は入っていない）で、
 * 式・答え・約○㎡ が文字どおりに出ること（浮動小数の誤差の文字が出ないこと）を確かめる。
 */
import {
    decimalText,
    isRectangle,
    occupancyApplyItems,
    occupancyApprox,
    occupancyEntityLabel,
    occupancyFormPatch,
    occupancyLabel,
    occupancyLabelAt,
    occupancyLabelPoint,
    occupancyMark,
    occupancyMeasure,
    occupancyNoteAt,
    occupancyNoteLines,
    occupancyTotal,
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
/** 直角三角形（直角は原点。a が x 方向・b が y 方向の辺） */
const rightTri = (a: number, b: number, ox = 0, oy = 0): DrawingPoint[] => [
    { x: ox, y: oy },
    { x: ox + a, y: oy },
    { x: ox, y: oy + b },
];
const occ = (points: DrawingPoint[], routeName = '', id = 'o1', labelAt: DrawingPoint | null = null): OccupancyEntity => ({
    id,
    kind: 'occupancy',
    layer: 2,
    style: DEFAULT_STYLE,
    points,
    routeName,
    labelAt,
});

describe('decimalText（整数 → 末尾の 0 を付けない小数の文字）', () => {
    it.each([
        [5750, 4, '0.575'],
        [101000, 4, '10.1'],
        [136408, 4, '13.6408'],
        [18000, 4, '1.8'],
        [5807500000, 9, '5.8075'],
        [192227200, 9, '0.1922272'],
        [0, 9, '0'],
        [2000000000, 9, '2'],
    ])('%d（桁 %d）→ %s', (n, scale, text) => {
        expect(decimalText(n, scale)).toBe(text);
    });
});

describe('occupancyMeasure: 許可が出た図面の数（§1.4）', () => {
    it.each([
        ['長方形 575×10,100', rect(0, 0, 10100, 575), '0.575×10.1＝5.8075㎡', '5.8075', 6],
        ['長方形 550×7,700', rect(0, 0, 7700, 550), '0.55×7.7＝4.235㎡', '4.235', 5],
        ['長方形 250×5,700', rect(0, 0, 5700, 250), '0.25×5.7＝1.425㎡', '1.425', 2],
        ['長方形 900×1,800', rect(0, 0, 1800, 900), '0.9×1.8＝1.62㎡', '1.62', 2],
        ['長方形 810×11,100（西条）', rect(9000, -810, 20100, 0), '0.81×11.1＝8.991㎡', '8.991', 9],
        ['直角三角形 508・756.8', rightTri(756.8, 508), '0.508×0.7568÷2＝0.1922272㎡', '0.1922272', 1],
        ['直角三角形 364.7・13,640.8', rightTri(364.7, 13640.8), '0.3647×13.6408÷2＝2.48739988㎡', '2.48739988', 3],
    ])('%s → %s', (_name, points, expression, areaText, approx) => {
        const m = occupancyMeasure(points);
        expect(m.expression).toBe(expression);
        expect(m.areaText).toBe(areaText);
        expect(occupancyApprox(m.areaN)).toBe(approx);
        // 浮動小数の誤差の文字（…99999 や …00001）が出ない
        expect(m.expression).not.toMatch(/9999|0001/);
    });

    it('2 つの三角形の合計: 0.1922272＋2.48739988＝2.67962708　約3', () => {
        const items = occupancyApplyItems([occ(rightTri(756.8, 508), '', 'a'), occ(rightTri(364.7, 13640.8), '', 'b')]);
        const total = occupancyTotal(items);
        expect(total.areaText).toBe('2.67962708');
        expect(total.approx).toBe(3);
    });

    it('長方形は 出幅×延長 の順・回転していても長方形（閉じる点が重なっていても）', () => {
        const m = occupancyMeasure(rect(9000, -810, 20100, 0));
        expect(m.kind).toBe('rect');
        expect(m.lengthM).toBeCloseTo(11.1);
        expect(m.widthM).toBeCloseTo(0.81);
        expect(m.lengthText).toBe('11.1');
        expect(m.widthText).toBe('0.81');
        const pts = rect(0, 0, 11100, 810).map((p) => rotatePoint(p, { x: 0, y: 0 }, 30));
        expect(isRectangle(pts)).toBe(true);
        const r = occupancyMeasure([...pts, pts[0]]);
        expect(r.kind).toBe('rect');
        expect(r.expression).toBe('0.81×11.1＝8.991㎡');
    });

    it('直角三角形は 直角をはさむ 2 辺（短い×長い÷2）。回転していても・直角がどの頂点でも', () => {
        const pts = rightTri(756.8, 508).map((p) => rotatePoint(p, { x: 0, y: 0 }, 37));
        expect(occupancyMeasure(pts).expression).toBe('0.508×0.7568÷2＝0.1922272㎡');
        // 直角が 2 番目の頂点
        const m = occupancyMeasure([
            { x: 0, y: 508 },
            { x: 0, y: 0 },
            { x: 756.8, y: 0 },
        ]);
        expect(m.kind).toBe('triangle');
        expect(m.expression).toBe('0.508×0.7568÷2＝0.1922272㎡');
    });

    it('直角でない三角形は 高さ×底辺÷2（底辺＝いちばん長い辺・高さは 0.1mm に丸め・面積は式の数から）', () => {
        // 底辺 10,080・高さ 1,531 → 1.531×10.08÷2＝7.71624
        const m = occupancyMeasure([
            { x: 0, y: 0 },
            { x: 10080, y: 0 },
            { x: 3000, y: 1531 },
        ]);
        expect(m.kind).toBe('triangle');
        expect(m.expression).toBe('1.531×10.08÷2＝7.71624㎡');
        expect(m.areaText).toBe('7.71624');
    });

    it('その他（台形）→ 面積（出幅 ○・延長 ○）。面積は頂点を 0.1mm に丸めた整数から', () => {
        // 下底 10,080・上底 5,352・高さ 1,000 → 7.716㎡・出幅 7.716/10.08＝0.7655…→ 0.7655（0.1mm）
        const m = occupancyMeasure([
            { x: 0, y: 0 },
            { x: 10080, y: 0 },
            { x: 7352, y: 1000 },
            { x: 2000, y: 1000 },
        ]);
        expect(m.kind).toBe('other');
        expect(m.areaText).toBe('7.716');
        expect(m.expression).toBe('7.716㎡（出幅 0.7655・延長 10.08）');
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

    it('点が足りない・面積 0 は 0㎡（約 0）', () => {
        expect(occupancyMeasure([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toMatchObject({ areaN: 0, areaText: '0', kind: 'other' });
        expect(occupancyApprox(0)).toBe(0);
    });

    it('「約○㎡」は ちょうどの値を切り上げ（2.0004 → 3・2 → 2）', () => {
        expect(occupancyApprox(2_000_400_000)).toBe(3);
        expect(occupancyApprox(2_000_000_000)).toBe(2);
        expect(occupancyApprox(1)).toBe(1);
    });
});

describe('図面の文字', () => {
    it('1 つのとき: 「路線名　式　約○㎡」（路線名が空なら式から）', () => {
        expect(occupancyLabel(occ(rect(0, 0, 1800, 900)))).toBe('0.9×1.8＝1.62㎡　約2㎡');
        expect(occupancyLabel(occ(rect(0, 0, 1800, 900), '市道南北97号線'))).toBe('市道南北97号線　0.9×1.8＝1.62㎡　約2㎡');
        expect(occupancyEntityLabel(occ(rect(0, 0, 1800, 900)), 0, 1)).toBe('0.9×1.8＝1.62㎡　約2㎡');
    });

    it('2 つ以上のとき: 範囲には ①②、まとまりは「申請物件」＋ 式 ＋ 合計と約', () => {
        const list = [occ(rightTri(756.8, 508), '', 'a'), occ(rightTri(364.7, 13640.8), '', 'b')];
        expect(occupancyEntityLabel(list[0], 0, 2)).toBe('①');
        expect(occupancyEntityLabel(list[1], 1, 2)).toBe('②');
        expect(occupancyNoteLines(list)).toEqual([
            '申請物件',
            '①　0.508×0.7568÷2＝0.1922272㎡',
            '②　0.3647×13.6408÷2＝2.48739988㎡',
            '0.1922272＋2.48739988＝2.67962708　約3㎡',
        ]);
        // 路線名があれば印の次に
        expect(occupancyNoteLines([occ(rect(0, 0, 1800, 900), '市道 A', 'a'), occ(rect(0, 0, 5700, 250), '', 'b')])[1]).toBe('①　市道 A　0.9×1.8＝1.62㎡');
        // 1 つ以下なら無し
        expect(occupancyNoteLines([list[0]])).toEqual([]);
        expect(occupancyMark(19)).toBe('⑳');
        expect(occupancyMark(20)).toBe('(21)');
    });

    it('文字の位置: 自動は重心・動かしてあればその位置', () => {
        const c = occupancyLabelPoint(rect(0, 0, 11100, 810));
        expect(c.x).toBeCloseTo(5550);
        expect(c.y).toBeCloseTo(405);
        expect(occupancyLabelAt(occ(rect(0, 0, 11100, 810)))).toEqual(c);
        expect(occupancyLabelAt(occ(rect(0, 0, 11100, 810), '', 'o1', { x: 1, y: 2 }))).toEqual({ x: 1, y: 2 });
    });

    it('まとまりの位置: 自動は範囲全体の左下から 1 行ぶん下（縮尺で実寸に）・動かしてあればその位置', () => {
        const list = [occ(rect(1000, 500, 2000, 800), '', 'a'), occ(rect(-100, 900, 50, 950), '', 'b')];
        // 文字 3mm × 行 1.4 × 縮尺 100 ＝ 420mm 下
        expect(occupancyNoteAt({ occupancyNoteAt: null, scale: 100 }, list)).toEqual({ x: -100, y: 500 - 420 });
        expect(occupancyNoteAt({ occupancyNoteAt: { x: 9, y: 9 }, scale: 100 }, list)).toEqual({ x: 9, y: 9 });
        expect(occupancyNoteAt({ occupancyNoteAt: null, scale: 100 }, [])).toEqual({ x: 0, y: 0 });
    });
});

describe('申請書への入れ方（規模＝別紙記入・長さと幅は空・数量＝合計）', () => {
    it('1 つでも 2 つ以上でも同じ形', () => {
        const one = occupancyApplyItems([occ(rect(0, 0, 10100, 575), '市道 新屋敷線')]);
        expect(occupancyFormPatch(one)).toEqual({ length: '', width: '', quantity: '5.8075', scaleNote: '別紙記入' });
        const two = occupancyApplyItems([occ(rightTri(756.8, 508), '', 'a'), occ(rightTri(364.7, 13640.8), '', 'b')]);
        expect(occupancyFormPatch(two)).toEqual({ length: '', width: '', quantity: '2.67962708', scaleNote: '別紙記入' });
    });

    it('0 件なら null', () => {
        expect(occupancyFormPatch([])).toBeNull();
    });
});
