/**
 * 「手当」の画面の小さな純粋関数（components/Allowances/allowancesClient.ts）。
 */
import {
    attendanceStatusLabelOf,
    chunkArray,
    csvFilenameWithCloseState,
    defaultAddDate,
    formatMonthLabel,
    formatMonthShort,
    kindLabelOf,
    monthEndDateKey,
    recordsQuery,
    shiftMonth,
    sourceLabelOf,
    yen,
} from '@/components/Allowances/allowancesClient';

describe('csvFilenameWithCloseState', () => {
    it('.csv の前に _締め済み / _未締め を足す', () => {
        expect(csvFilenameWithCloseState('allowances_summary_2026-09.csv', true)).toBe('allowances_summary_2026-09_締め済み.csv');
        expect(csvFilenameWithCloseState('allowances_detail_2026-10.csv', false)).toBe('allowances_detail_2026-10_未締め.csv');
    });
    it('.csv で終わらない名前は末尾に足す', () => {
        expect(csvFilenameWithCloseState('allowances', true)).toBe('allowances_締め済み');
    });
});

describe('shiftMonth', () => {
    it('前の月・次の月（年をまたぐ）', () => {
        expect(shiftMonth('2026-10', -1)).toBe('2026-09');
        expect(shiftMonth('2026-01', -1)).toBe('2025-12');
        expect(shiftMonth('2026-12', 1)).toBe('2027-01');
        expect(shiftMonth('2026-09', 0)).toBe('2026-09');
    });
});

describe('monthEndDateKey', () => {
    it('月の末日（うるう年を含む）', () => {
        expect(monthEndDateKey('2026-09')).toBe('2026-09-30');
        expect(monthEndDateKey('2026-02')).toBe('2026-02-28');
        expect(monthEndDateKey('2028-02')).toBe('2028-02-29');
    });
});

describe('defaultAddDate（「記録を足す」の日付の初期値）', () => {
    it('見ている月が今月なら今日', () => {
        expect(defaultAddDate('2026-10', '2026-10-05')).toBe('2026-10-05');
    });
    it('それ以外の月はその月の末日', () => {
        expect(defaultAddDate('2026-09', '2026-10-05')).toBe('2026-09-30');
    });
    it('先の月を見ているときは今日（max は今日）', () => {
        expect(defaultAddDate('2026-11', '2026-10-05')).toBe('2026-10-05');
    });
});

describe('attendanceStatusLabelOf', () => {
    it('出勤簿の区分のコードを言葉に直す', () => {
        expect(attendanceStatusLabelOf('absent')).toBe('欠勤');
        expect(attendanceStatusLabelOf('paid_leave')).toBe('有給');
        expect(attendanceStatusLabelOf('holiday')).toBe('休日');
        expect(attendanceStatusLabelOf('compensatory_holiday')).toBe('代休');
    });
    it('知らないコードはそのまま・null は「出勤簿なし」', () => {
        expect(attendanceStatusLabelOf('something_new')).toBe('something_new');
        expect(attendanceStatusLabelOf(null)).toBe('出勤簿なし');
    });
});

describe('言葉と金額', () => {
    it('入力元', () => {
        expect(sourceLabelOf('attendance')).toBe('出勤簿入力');
        expect(sourceLabelOf('manual')).toBe('手当の画面');
        expect(sourceLabelOf('bulk')).toBe('手配と見比べる');
        expect(sourceLabelOf('other')).toBe('other');
    });
    it('区分（社員・一人親方）', () => {
        expect(kindLabelOf(false)).toBe('社員');
        expect(kindLabelOf(true)).toBe('一人親方');
    });
    it('金額は3けたごとに区切る', () => {
        expect(yen(1500)).toBe('1,500円');
        expect(yen(200)).toBe('200円');
        expect(yen(0)).toBe('0円');
    });
    it('月の表示', () => {
        expect(formatMonthLabel('2026-09')).toBe('2026年9月');
        expect(formatMonthShort('2026-10')).toBe('10月');
    });
});

describe('recordsQuery', () => {
    it('使わないパラメータは付けない（空で送ると 400）', () => {
        expect(recordsQuery({ status: 'pending' })).toBe('status=pending');
        expect(recordsQuery({ month: '2026-09', userId: 'u1' })).toBe('month=2026-09&userId=u1');
        expect(recordsQuery({ month: '2026-09', userId: '' })).toBe('month=2026-09');
    });
});

describe('chunkArray', () => {
    it('size 件ずつに分ける', () => {
        expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunkArray([], 2000)).toEqual([]);
    });
});
