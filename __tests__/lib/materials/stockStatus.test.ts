/**
 * 在庫ステータス判定 computeStockStatus / stockRatioPercent の単体テスト。
 *
 * 検証観点（実装指示書 §4）:
 *   (a) stock < 0 → 'shortage'（要確認）
 *   (b) 残率 < 25% → 'low'（わずか）
 *   (c) それ以外 → 'ok'（十分）
 *   (d) total <= 0 の境界（割合が定義できない）
 *   (e) バーのパーセントは 0〜100% にクランプ
 */
import {
    computeStockStatus,
    stockStatusLabel,
    stockRatioPercent,
    LOW_STOCK_RATIO,
} from '@/lib/materials/stockStatus';

describe('computeStockStatus', () => {
    it('(a) 倉庫在庫が負 → shortage（所有総数に関係なく）', () => {
        expect(computeStockStatus(-147, 880)).toBe('shortage');
        expect(computeStockStatus(-1, 0)).toBe('shortage');
    });

    it('(b) 残率がしきい値未満 → low', () => {
        // 157 / 647 ≒ 24.3% < 25%
        expect(computeStockStatus(157, 647)).toBe('low');
        // 0 / 185 = 0%
        expect(computeStockStatus(0, 185)).toBe('low');
    });

    it('(c) 残率がしきい値以上 → ok', () => {
        // 475 / 1283 ≒ 37% >= 25%
        expect(computeStockStatus(475, 1283)).toBe('ok');
        // ちょうどしきい値（25%）は ok
        expect(computeStockStatus(25, 100)).toBe('ok');
    });

    it('(d) 所有総数 0 は shortage 以外なら ok（割合は判定しない）', () => {
        expect(computeStockStatus(0, 0)).toBe('ok');
    });

    it('しきい値定数は 0.25', () => {
        expect(LOW_STOCK_RATIO).toBe(0.25);
    });
});

describe('stockStatusLabel', () => {
    it('日本語ラベルを返す', () => {
        expect(stockStatusLabel('ok')).toBe('十分');
        expect(stockStatusLabel('low')).toBe('わずか');
        expect(stockStatusLabel('shortage')).toBe('要確認');
    });
});

describe('stockRatioPercent', () => {
    it('(e) 倉庫割合を四捨五入し 0〜100% にクランプ', () => {
        expect(stockRatioPercent(475, 1283)).toBe(37);
        expect(stockRatioPercent(0, 185)).toBe(0);
        expect(stockRatioPercent(-147, 880)).toBe(0); // 負は 0%
        expect(stockRatioPercent(100, 0)).toBe(0); // total 0 は 0%
        expect(stockRatioPercent(100, 100)).toBe(100);
    });
});
