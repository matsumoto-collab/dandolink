import { toJstDateOnly } from '@/lib/dateUtils';

describe('toJstDateOnly', () => {
    it('JST 0時保存の配置(…T15:00:00Z)を翌日(JST日)のUTC 0時に丸める', () => {
        // 2026-05-17T15:00:00.000Z === JST 2026-05-18 00:00
        const result = toJstDateOnly('2026-05-17T15:00:00.000Z');
        expect(result.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });

    it('UTC 0時保存(…T00:00:00Z)も同じJST日に正規化する', () => {
        const result = toJstDateOnly('2026-05-18T00:00:00.000Z');
        expect(result.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });

    it('"YYYY-MM-DD" 文字列(UTC 0時扱い)を同日のUTC 0時にする', () => {
        const result = toJstDateOnly('2026-05-18');
        expect(result.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });

    it('JST日付の境界をまたぐ前日23:59:59Zは翌JST日になる', () => {
        // 2026-05-17T15:00:00Z 直前は JST 5/17、直後は JST 5/18
        expect(toJstDateOnly('2026-05-17T14:59:59.999Z').toISOString())
            .toBe('2026-05-17T00:00:00.000Z');
        expect(toJstDateOnly('2026-05-17T15:00:00.000Z').toISOString())
            .toBe('2026-05-18T00:00:00.000Z');
    });

    it('Date インスタンスも受け付ける', () => {
        const result = toJstDateOnly(new Date('2026-05-17T15:00:00.000Z'));
        expect(result.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });

    it('JST午後（昼間）の絶対時刻も正しいJST日に丸める', () => {
        // 2026-05-18T08:30:00Z === JST 2026-05-18 17:30
        const result = toJstDateOnly('2026-05-18T08:30:00.000Z');
        expect(result.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    });

    it('月跨ぎ: JST 6/1 0時 (= 5/31T15:00Z) は 6/1 になる', () => {
        const result = toJstDateOnly('2026-05-31T15:00:00.000Z');
        expect(result.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });
});
