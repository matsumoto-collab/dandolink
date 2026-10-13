/**
 * 道路申請の記号（Phase 2b）の並べ方: 線に沿って等間隔（arrayAlong）・コーン列（coneRowLayout）。
 * docs/指示書_道路申請_Phase2b_記号.md §5.1・§6-2（10,000mm・1500p（間隔 1,403）→ コーン 9・バー 8・間隔 1,250）
 */
import { arrayAlong, coneRowLayout } from '@/lib/roadPermit/symbols/place';

describe('arrayAlong（線に沿って等間隔）', () => {
    it('始点を含み、終点を越えない', () => {
        const pts = arrayAlong({ x: 0, y: 0 }, { x: 5000, y: 0 }, 2000);
        expect(pts.map((p) => p.x)).toEqual([0, 2000, 4000]);
        expect(pts.every((p) => p.y === 0)).toBe(true);
    });

    it('割り切れるときは終点にも置く', () => {
        const pts = arrayAlong({ x: 0, y: 0 }, { x: 10000, y: 0 }, 2000);
        expect(pts).toHaveLength(6);
        expect(pts[5].x).toBeCloseTo(10000);
    });

    it('斜めの線でも線の上に並ぶ', () => {
        const pts = arrayAlong({ x: 0, y: 0 }, { x: 3000, y: 4000 }, 1000);
        expect(pts).toHaveLength(6);
        expect(pts[1].x).toBeCloseTo(600);
        expect(pts[1].y).toBeCloseTo(800);
    });

    it('間隔が 0 以下か、始点と終点が同じなら始点だけ', () => {
        expect(arrayAlong({ x: 1, y: 2 }, { x: 100, y: 0 }, 0)).toEqual([{ x: 1, y: 2 }]);
        expect(arrayAlong({ x: 1, y: 2 }, { x: 100, y: 0 }, -5)).toEqual([{ x: 1, y: 2 }]);
        expect(arrayAlong({ x: 1, y: 2 }, { x: 1, y: 2 }, 100)).toEqual([{ x: 1, y: 2 }]);
    });
});

describe('coneRowLayout（コーン列）', () => {
    it('10,000mm の直線・P=1,403 → コーン 9・バー 8・コーンの間隔 1,250', () => {
        const { cones, bars } = coneRowLayout([{ x: 0, y: 0 }, { x: 10000, y: 0 }], 1403);
        expect(cones).toHaveLength(9);
        expect(bars).toHaveLength(8);
        cones.forEach((c, i) => {
            expect(c.x).toBeCloseTo(i * 1250);
            expect(c.y).toBeCloseTo(0);
        });
        bars.forEach((b, i) => {
            expect(b.at.x).toBeCloseTo(625 + i * 1250);
            expect(b.at.y).toBeCloseTo(0);
            expect(b.rotationDeg).toBeCloseTo(0);
        });
    });

    it('割り切れる長さで余分なバーを足さない（2,806 ÷ 1,403 ＝ 2 本）', () => {
        const { cones, bars } = coneRowLayout([{ x: 0, y: 0 }, { x: 2806, y: 0 }], 1403);
        expect(bars).toHaveLength(2);
        expect(cones).toHaveLength(3);
    });

    it('L 字（2 区間）: 曲がり角のコーンは 1 個', () => {
        const { cones, bars } = coneRowLayout(
            [
                { x: 0, y: 0 },
                { x: 3000, y: 0 },
                { x: 3000, y: 2000 },
            ],
            1403,
        );
        // 3,000 → 3 本（間隔 1,000）・2,000 → 2 本（間隔 1,000）
        expect(bars).toHaveLength(5);
        expect(cones).toHaveLength(6);
        const atCorner = cones.filter((c) => Math.abs(c.x - 3000) < 1e-6 && Math.abs(c.y) < 1e-6);
        expect(atCorner).toHaveLength(1);
        expect(bars.slice(0, 3).every((b) => Math.abs(b.rotationDeg) < 1e-9)).toBe(true);
        expect(bars.slice(3).every((b) => Math.abs(b.rotationDeg - 90) < 1e-9)).toBe(true);
    });

    it('斜めの区間: バーの角度は区間の角度', () => {
        const { bars } = coneRowLayout([{ x: 0, y: 0 }, { x: 1000, y: 1000 }], 1403);
        expect(bars).toHaveLength(2);
        bars.forEach((b) => expect(b.rotationDeg).toBeCloseTo(45));
        expect(bars[0].at.x).toBeCloseTo(250);
        expect(bars[0].at.y).toBeCloseTo(250);
    });

    it('長さ 0 の区間は飛ばす・点が 1 つならコーン 1 個・点が無ければ空', () => {
        const dup = coneRowLayout([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }], 1403);
        expect(dup.cones).toHaveLength(2);
        expect(dup.bars).toHaveLength(1);
        expect(coneRowLayout([{ x: 5, y: 5 }], 1403)).toEqual({ cones: [{ x: 5, y: 5 }], bars: [] });
        expect(coneRowLayout([], 1403)).toEqual({ cones: [], bars: [] });
    });
});
