/**
 * 道路申請の表記の部品（lib/roadPermit/format.ts）。
 * 日数・和暦・時刻・面積は様式に印字する文字そのものなので、原本の値（令和7年・令和8年の申請）で確かめる。
 */
import {
    approxAreaOf,
    countDaysInclusive,
    effectiveApproxArea,
    effectiveDayCount,
    formatHourLabel,
    formatReiwaRange,
    formatReiwaYmdOrBlank,
    parseQuantity,
    reiwaParts,
} from '@/lib/roadPermit/format';

describe('countDaysInclusive（初日と末日を含めて数える）', () => {
    it('原本の期間どおりの日数になる', () => {
        expect(countDaysInclusive('2025-05-01', '2025-08-31')).toBe(123);
        expect(countDaysInclusive('2025-10-24', '2026-08-23')).toBe(304);
        expect(countDaysInclusive('2025-09-15', '2025-11-13')).toBe(60);
    });

    it('同じ日は 1 日', () => {
        expect(countDaysInclusive('2026-09-05', '2026-09-05')).toBe(1);
    });

    it('逆順・空・不正な日付は null（勝手な数を印字しない）', () => {
        expect(countDaysInclusive('2025-08-31', '2025-05-01')).toBeNull();
        expect(countDaysInclusive('', '2025-05-01')).toBeNull();
        expect(countDaysInclusive('2025-05-01', '')).toBeNull();
        expect(countDaysInclusive('2025-02-30', '2025-03-01')).toBeNull();
        expect(countDaysInclusive('2025/05/01', '2025-05-02')).toBeNull();
    });
});

describe('effectiveDayCount（手で直した日数が優先）', () => {
    it('上書きがあればそれを使う', () => {
        expect(effectiveDayCount('2025-05-01', '2025-08-31', 100)).toBe(100);
        expect(effectiveDayCount('', '', 5)).toBe(5);
    });

    it('上書きが無ければ自動で数える', () => {
        expect(effectiveDayCount('2025-05-01', '2025-08-31', null)).toBe(123);
        expect(effectiveDayCount('', '', null)).toBeNull();
    });
});

describe('和暦', () => {
    it('reiwaParts: 年・月・日に分ける。空は全部 null', () => {
        expect(reiwaParts('2026-09-05')).toEqual({ year: 8, month: 9, day: 5 });
        expect(reiwaParts('')).toEqual({ year: null, month: null, day: null });
    });

    it('formatReiwaYmdOrBlank: 空は「令和　年　月　日」と空けて印刷する', () => {
        expect(formatReiwaYmdOrBlank('2026-09-05')).toBe('令和8年9月5日');
        expect(formatReiwaYmdOrBlank('')).toBe('令和　年　月　日');
    });

    it('formatReiwaRange: 「〜から〜まで」。片方が空でも枠は残す', () => {
        expect(formatReiwaRange('2026-09-05', '2026-10-04')).toBe('令和8年9月5日から令和8年10月4日まで');
        expect(formatReiwaRange('2026-09-05', '')).toBe('令和8年9月5日から令和　年　月　日まで');
    });
});

describe('formatHourLabel（警察の「○時から○時まで」）', () => {
    it('分が 0 なら「時」だけ、それ以外は「時○分」', () => {
        expect(formatHourLabel('09:00')).toBe('9時');
        expect(formatHourLabel('17:00')).toBe('17時');
        expect(formatHourLabel('09:30')).toBe('9時30分');
    });

    it('空・不正は「　時」と空けて印刷する', () => {
        expect(formatHourLabel('')).toBe('　時');
        expect(formatHourLabel('25:00')).toBe('　時');
    });
});

describe('面積', () => {
    it('parseQuantity: 全角数字も読める。空・不正は null', () => {
        expect(parseQuantity('0.9486')).toBeCloseTo(0.9486);
        expect(parseQuantity('０．９４８６')).toBeCloseTo(0.9486);
        expect(parseQuantity('')).toBeNull();
        expect(parseQuantity('abc')).toBeNull();
    });

    it('approxAreaOf: 「約○㎡」は数量を切り上げた整数（整数はそのまま）', () => {
        expect(approxAreaOf('0.9486')).toBe('1');
        expect(approxAreaOf('1.821')).toBe('2');
        expect(approxAreaOf('3.402')).toBe('4');
        expect(approxAreaOf('2')).toBe('2');
        expect(approxAreaOf('')).toBe('');
    });

    it('effectiveApproxArea: 手で直した値が優先（空文字の上書きも尊重する）', () => {
        expect(effectiveApproxArea('0.9486', null)).toBe('1');
        expect(effectiveApproxArea('0.9486', '3')).toBe('3');
        expect(effectiveApproxArea('0.9486', '')).toBe('');
    });
});
