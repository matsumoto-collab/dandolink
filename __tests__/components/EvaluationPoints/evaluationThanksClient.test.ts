/**
 * components/EvaluationPoints/evaluationThanksClient.ts（「ありがとう」の画面の小さな純粋関数）のテスト。
 */
import {
    formatThanksMonthLabel,
    hasThanksItem,
    isValidThanksMonthKey,
    messageCountLabel,
    parseThanksPointsInput,
    receivedHeadingLabel,
    remainingTodayLabel,
    sentHeadingLabel,
    shiftThanksMonth,
    thanksMonthKeyOf,
    thanksMonthRange,
    thanksReceivedBy,
    type ThanksListRow,
} from '@/components/EvaluationPoints/evaluationThanksClient';

describe('月', () => {
    it('thanksMonthKeyOf は日付から YYYY-MM', () => {
        expect(thanksMonthKeyOf('2026-10-05')).toBe('2026-10');
    });

    it('thanksMonthRange は初日と末日（うるう年の2月・12月も）', () => {
        expect(thanksMonthRange('2026-10')).toEqual({ startDate: '2026-10-01', endDate: '2026-10-31' });
        expect(thanksMonthRange('2028-02')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
        expect(thanksMonthRange('2026-02')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
        expect(thanksMonthRange('2026-12')).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' });
    });

    it('shiftThanksMonth は年をまたぐ', () => {
        expect(shiftThanksMonth('2026-10', -1)).toBe('2026-09');
        expect(shiftThanksMonth('2026-10', 1)).toBe('2026-11');
        expect(shiftThanksMonth('2026-12', 1)).toBe('2027-01');
        expect(shiftThanksMonth('2026-01', -1)).toBe('2025-12');
        expect(shiftThanksMonth('2026-01', -13)).toBe('2024-12');
    });

    it('formatThanksMonthLabel は「2026年10月」', () => {
        expect(formatThanksMonthLabel('2026-10')).toBe('2026年10月');
        expect(formatThanksMonthLabel('2027-01')).toBe('2027年1月');
    });

    it('isValidThanksMonthKey', () => {
        expect(isValidThanksMonthKey('2026-10')).toBe(true);
        expect(isValidThanksMonthKey('2026-00')).toBe(false);
        expect(isValidThanksMonthKey('2026-13')).toBe(false);
        expect(isValidThanksMonthKey('2026-1')).toBe(false);
        expect(isValidThanksMonthKey('')).toBe(false);
    });
});

describe('表示の言葉', () => {
    it('remainingTodayLabel は残りの回数／0回なら上限の回数', () => {
        expect(remainingTodayLabel(3, 3)).toBe('今日は、あと3回送れます');
        expect(remainingTodayLabel(1, 3)).toBe('今日は、あと1回送れます');
        expect(remainingTodayLabel(0, 3)).toBe('今日は、もう3回送りました');
    });

    it('receivedHeadingLabel は点数を渡したときだけ「・◯点」', () => {
        expect(receivedHeadingLabel(2, null)).toBe('もらった 2回');
        expect(receivedHeadingLabel(2, 4)).toBe('もらった 2回・4点');
        expect(receivedHeadingLabel(0, 0)).toBe('もらった 0回・0点');
    });

    it('sentHeadingLabel', () => {
        expect(sentHeadingLabel(1)).toBe('送った 1回');
    });

    it('messageCountLabel は「◯ / 100」', () => {
        expect(messageCountLabel('')).toBe('0 / 100');
        expect(messageCountLabel('ありがとう')).toBe('5 / 100');
    });
});

describe('parseThanksPointsInput', () => {
    it('0〜9999 の整数を受け付ける（前後の空白は取る）', () => {
        expect(parseThanksPointsInput('0')).toBe(0);
        expect(parseThanksPointsInput('1')).toBe(1);
        expect(parseThanksPointsInput(' 25 ')).toBe(25);
        expect(parseThanksPointsInput('9999')).toBe(9999);
    });

    it('範囲の外・整数でない・数字以外は null', () => {
        for (const text of ['', ' ', '10000', '-1', '1.5', '1e3', 'abc', '１', '+1']) {
            expect(parseThanksPointsInput(text)).toBeNull();
        }
    });
});

describe('一覧', () => {
    const row = (id: string, toUserId: string): ThanksListRow => ({
        id,
        date: '2026-10-03',
        fromUserId: 'from',
        fromUserName: '送った人',
        toUserId,
        toUserName: 'もらった人',
        message: null,
        points: 1,
        createdAt: '2026-10-03T00:00:00.000Z',
    });

    it('thanksReceivedBy はその人がもらった分だけ（並びはそのまま）', () => {
        const rows = [row('a', 'u1'), row('b', 'u2'), row('c', 'u1')];
        expect(thanksReceivedBy(rows, 'u1').map((r) => r.id)).toEqual(['a', 'c']);
        expect(thanksReceivedBy(rows, 'u3')).toEqual([]);
    });

    it('hasThanksItem は仮の項目（__thanks__）があるときだけ true', () => {
        expect(hasThanksItem([{ id: 'x' }, { id: '__thanks__' }])).toBe(true);
        expect(hasThanksItem([{ id: 'x' }])).toBe(false);
        expect(hasThanksItem([])).toBe(false);
        expect(hasThanksItem(null)).toBe(false);
        expect(hasThanksItem(undefined)).toBe(false);
    });
});
