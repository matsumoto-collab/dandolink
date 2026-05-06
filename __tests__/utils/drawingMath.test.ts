import {
    distance,
    perimeterMm,
    polygonAreaMm2,
    scaffoldArea,
    computeStats,
    snapTo8Dir,
    computeBoundingBox,
    fitToCanvas,
    pxToMm,
    mmToPx,
    canCloseAt,
} from '@/utils/drawingMath';
import type { Point, Section, CanvasFit } from '@/stores/siteSurveySlices/types';

describe('drawingMath', () => {
    describe('distance', () => {
        it('returns Euclidean distance in mm', () => {
            expect(distance({ x: 0, y: 0 }, { x: 3000, y: 4000 })).toBe(5000);
        });
    });

    describe('perimeterMm', () => {
        it('returns 0 for fewer than 2 points', () => {
            expect(perimeterMm([], false)).toBe(0);
            expect(perimeterMm([{ x: 0, y: 0 }], true)).toBe(0);
        });
        it('open polyline excludes closing edge', () => {
            const pts: Point[] = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }];
            expect(perimeterMm(pts, false)).toBe(8000);
        });
        it('closed polygon includes closing edge', () => {
            const pts: Point[] = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }];
            expect(perimeterMm(pts, true)).toBe(16000);
        });
    });

    describe('polygonAreaMm2', () => {
        it('returns 0 for fewer than 3 points', () => {
            expect(polygonAreaMm2([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(0);
        });
        it('rectangle 5m × 3m → 15 m²', () => {
            const pts: Point[] = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }];
            expect(polygonAreaMm2(pts)).toBe(15_000_000);
        });
        it('triangle clockwise', () => {
            // 3-4-5 直角三角形 (3m × 4m)
            const pts: Point[] = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 0, y: 4000 }];
            expect(polygonAreaMm2(pts)).toBe(6_000_000);
        });
        it('triangle counter-clockwise (same absolute area)', () => {
            const pts: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 4000 }, { x: 3000, y: 0 }];
            expect(polygonAreaMm2(pts)).toBe(6_000_000);
        });
    });

    describe('scaffoldArea', () => {
        it('= (perimeterM + correctionM) × (heightMm/1000)', () => {
            expect(scaffoldArea(20, 8200, 0)).toBeCloseTo(164, 5);
            expect(scaffoldArea(16, 8000, 2)).toBeCloseTo(144, 5);
        });
    });

    describe('computeStats - L字サンプル', () => {
        const lShapeSection: Section = {
            id: 'section-1',
            name: '本棟',
            height: 8200,
            polygon: {
                points: [
                    { x: 0, y: 0 },
                    { x: 5000, y: 0 },
                    { x: 5000, y: 3000 },
                    { x: 3000, y: 3000 },
                    { x: 3000, y: 5000 },
                    { x: 0, y: 5000 },
                ],
                closed: true,
            },
            openings: [],
        };
        it('外周 20m, 床面積 21㎡, 足場面積 164㎡', () => {
            const stats = computeStats(lShapeSection, 0);
            expect(stats.perimeter).toBeCloseTo(20, 5);
            expect(stats.floorArea).toBeCloseTo(21, 5);
            expect(stats.scaffoldArea).toBeCloseTo(164, 5);
        });
    });

    describe('computeStats - 矩形 5m×3m', () => {
        const rect: Section = {
            id: 's', name: '矩形', height: 8000,
            polygon: {
                points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }],
                closed: true,
            },
            openings: [],
        };
        it('外周 16m, 床面積 15㎡', () => {
            const stats = computeStats(rect, 0);
            expect(stats.perimeter).toBeCloseTo(16, 5);
            expect(stats.floorArea).toBeCloseTo(15, 5);
        });
    });

    describe('snapTo8Dir', () => {
        // 注: dy は screen 座標（下が正）。dy<0 が N。
        it('right → E', () => expect(snapTo8Dir(1, 0)).toBe('E'));
        it('left → W', () => expect(snapTo8Dir(-1, 0)).toBe('W'));
        it('up (dy<0) → N', () => expect(snapTo8Dir(0, -1)).toBe('N'));
        it('down (dy>0) → S', () => expect(snapTo8Dir(0, 1)).toBe('S'));
        it('NE diag (right + up)', () => expect(snapTo8Dir(1, -1)).toBe('NE'));
        it('SW diag (left + down)', () => expect(snapTo8Dir(-1, 1)).toBe('SW'));
        // 境界値: 22.5° 周辺（E と SE の境界）
        it('just under 22.5° → E', () => {
            const angle = (22 * Math.PI) / 180;
            expect(snapTo8Dir(Math.cos(angle), Math.sin(angle))).toBe('E');
        });
        it('just over 22.5° → SE', () => {
            const angle = (23 * Math.PI) / 180;
            expect(snapTo8Dir(Math.cos(angle), Math.sin(angle))).toBe('SE');
        });
        // 45° 中央 → SE
        it('45° → SE', () => {
            const angle = (45 * Math.PI) / 180;
            expect(snapTo8Dir(Math.cos(angle), Math.sin(angle))).toBe('SE');
        });
        // 67.5° 周辺
        it('just under 67.5° → SE', () => {
            const angle = (67 * Math.PI) / 180;
            expect(snapTo8Dir(Math.cos(angle), Math.sin(angle))).toBe('SE');
        });
        it('just over 67.5° → S', () => {
            const angle = (68 * Math.PI) / 180;
            expect(snapTo8Dir(Math.cos(angle), Math.sin(angle))).toBe('S');
        });
        it('zero vector defaults to E', () => expect(snapTo8Dir(0, 0)).toBe('E'));
    });

    describe('computeBoundingBox', () => {
        it('returns default for empty', () => {
            expect(computeBoundingBox([])).toEqual({ minX: 0, maxX: 10000, minY: 0, maxY: 10000 });
        });
        it('computes min/max', () => {
            const pts: Point[] = [{ x: 100, y: 200 }, { x: 5000, y: 50 }, { x: 0, y: 3000 }];
            expect(computeBoundingBox(pts)).toEqual({ minX: 0, maxX: 5000, minY: 50, maxY: 3000 });
        });
    });

    describe('pxToMm / mmToPx round-trip', () => {
        const fit: CanvasFit = { scale: 0.05, offsetX: 60, offsetY: 80 };
        it('mm→px→mm restores original', () => {
            const mm: Point = { x: 1234, y: 5678 };
            const px = mmToPx(mm, fit);
            const back = pxToMm(px, fit);
            expect(back.x).toBeCloseTo(mm.x, 5);
            expect(back.y).toBeCloseTo(mm.y, 5);
        });
        it('px→mm→px restores original', () => {
            const px = { x: 200, y: 350 };
            const mm = pxToMm(px, fit);
            const back = mmToPx(mm, fit);
            expect(back.x).toBeCloseTo(px.x, 5);
            expect(back.y).toBeCloseTo(px.y, 5);
        });
    });

    describe('canCloseAt', () => {
        const open3: Section = {
            id: 's', name: '', height: 8000,
            polygon: {
                points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }],
                closed: false,
            },
            openings: [],
        };
        it('within threshold → true', () => {
            expect(canCloseAt(open3, { x: 500, y: 500 }, 800)).toBe(true);
        });
        it('outside threshold → false', () => {
            expect(canCloseAt(open3, { x: 2000, y: 2000 }, 800)).toBe(false);
        });
        it('already closed → false', () => {
            const closed = { ...open3, polygon: { ...open3.polygon, closed: true } };
            expect(canCloseAt(closed, { x: 0, y: 0 }, 800)).toBe(false);
        });
        it('fewer than 3 points → false', () => {
            const sparse: Section = {
                ...open3,
                polygon: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false },
            };
            expect(canCloseAt(sparse, { x: 0, y: 0 }, 800)).toBe(false);
        });
    });

    describe('fitToCanvas', () => {
        it('zero size avoids division by zero', () => {
            const fit = fitToCanvas({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 600, 600, 40);
            expect(Number.isFinite(fit.scale)).toBe(true);
            expect(Number.isFinite(fit.offsetX)).toBe(true);
        });
        it('scales to fit smaller dimension', () => {
            const fit = fitToCanvas({ minX: 0, maxX: 1000, minY: 0, maxY: 100 }, 600, 600, 0);
            // 横が制約 → 1000 に対して 600 → scale=0.6
            expect(fit.scale).toBeCloseTo(0.6, 5);
        });
    });
});
