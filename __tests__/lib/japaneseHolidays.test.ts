import {
    getHolidaysOfYear,
    getJapaneseHolidayName,
    isJapaneseHoliday,
} from '@/lib/japaneseHolidays';

/**
 * 置き換え前に utils/dateUtils.ts が持っていた手書きテーブル（2024〜2026）。
 * 計算結果がこれと1日も違わないことを確かめる＝既存表示の回帰テストになる。
 */
const HANDWRITTEN: Record<string, string> = {
    // 2024年
    '2024-01-01': '元日', '2024-01-08': '成人の日', '2024-02-11': '建国記念の日',
    '2024-02-12': '振替休日', '2024-02-23': '天皇誕生日', '2024-03-20': '春分の日',
    '2024-04-29': '昭和の日', '2024-05-03': '憲法記念日', '2024-05-04': 'みどりの日',
    '2024-05-05': 'こどもの日', '2024-05-06': '振替休日', '2024-07-15': '海の日',
    '2024-08-11': '山の日', '2024-08-12': '振替休日', '2024-09-16': '敬老の日',
    '2024-09-22': '秋分の日', '2024-09-23': '振替休日', '2024-10-14': 'スポーツの日',
    '2024-11-03': '文化の日', '2024-11-04': '振替休日', '2024-11-23': '勤労感謝の日',
    // 2025年
    '2025-01-01': '元日', '2025-01-13': '成人の日', '2025-02-11': '建国記念の日',
    '2025-02-23': '天皇誕生日', '2025-02-24': '振替休日', '2025-03-20': '春分の日',
    '2025-04-29': '昭和の日', '2025-05-03': '憲法記念日', '2025-05-04': 'みどりの日',
    '2025-05-05': 'こどもの日', '2025-05-06': '振替休日', '2025-07-21': '海の日',
    '2025-08-11': '山の日', '2025-09-15': '敬老の日', '2025-09-23': '秋分の日',
    '2025-10-13': 'スポーツの日', '2025-11-03': '文化の日', '2025-11-23': '勤労感謝の日',
    '2025-11-24': '振替休日',
    // 2026年
    '2026-01-01': '元日', '2026-01-12': '成人の日', '2026-02-11': '建国記念の日',
    '2026-02-23': '天皇誕生日', '2026-03-20': '春分の日', '2026-04-29': '昭和の日',
    '2026-05-03': '憲法記念日', '2026-05-04': 'みどりの日', '2026-05-05': 'こどもの日',
    '2026-05-06': '振替休日', '2026-07-20': '海の日', '2026-08-11': '山の日',
    '2026-09-21': '敬老の日', '2026-09-22': '国民の休日', '2026-09-23': '秋分の日',
    '2026-10-12': 'スポーツの日', '2026-11-03': '文化の日', '2026-11-23': '勤労感謝の日',
};

describe('getHolidaysOfYear（手書きテーブルとの一致）', () => {
    it.each([2024, 2025, 2026])('%i年の祝日が手書きテーブルと完全に一致する', year => {
        const expected = Object.entries(HANDWRITTEN)
            .filter(([key]) => key.startsWith(String(year)))
            .sort(([a], [b]) => a.localeCompare(b));
        const actual = [...getHolidaysOfYear(year).entries()].sort(([a], [b]) => a.localeCompare(b));
        expect(actual).toEqual(expected);
    });
});

describe('年が変わっても出る（テーブル方式で抜けていた範囲）', () => {
    it('2027年も計算できる', () => {
        const h = getHolidaysOfYear(2027);
        expect(h.get('2027-01-01')).toBe('元日');
        expect(h.get('2027-01-11')).toBe('成人の日'); // 1月第2月曜
        expect(h.get('2027-03-21')).toBe('春分の日');
        expect(h.get('2027-03-22')).toBe('振替休日'); // 春分が日曜
        expect(h.get('2027-07-19')).toBe('海の日');   // 7月第3月曜
        expect(h.get('2027-09-23')).toBe('秋分の日');
        expect(h.get('2027-10-11')).toBe('スポーツの日');
    });

    it('2030年も計算できる', () => {
        const h = getHolidaysOfYear(2030);
        expect(h.get('2030-01-01')).toBe('元日');
        expect(h.get('2030-05-05')).toBe('こどもの日');
        expect(h.get('2030-05-06')).toBe('振替休日'); // こどもの日が日曜
        expect(h.get('2030-11-23')).toBe('勤労感謝の日');
    });
});

describe('規則ごとの確認', () => {
    it('ハッピーマンデーは必ず月曜', () => {
        for (const year of [2026, 2027, 2028]) {
            const h = getHolidaysOfYear(year);
            for (const [key, name] of h) {
                if (['成人の日', '海の日', '敬老の日', 'スポーツの日'].includes(name)) {
                    expect(new Date(`${key}T00:00:00`).getDay()).toBe(1);
                }
            }
        }
    });

    it('振替休日は日曜の祝日の翌平日（連休が続けばその先）', () => {
        // 2026-05-03(日) 憲法記念日 → 5/4・5/5 も祝日なので振替は 5/6
        const h = getHolidaysOfYear(2026);
        expect(new Date('2026-05-03T00:00:00').getDay()).toBe(0);
        expect(h.get('2026-05-06')).toBe('振替休日');
        expect(h.has('2026-05-07')).toBe(false);
    });

    it('国民の休日は祝日に挟まれた平日だけ（2026年9月22日）', () => {
        const h = getHolidaysOfYear(2026);
        expect(h.get('2026-09-21')).toBe('敬老の日');
        expect(h.get('2026-09-22')).toBe('国民の休日');
        expect(h.get('2026-09-23')).toBe('秋分の日');
        // 挟まれていない年には出ない
        expect([...getHolidaysOfYear(2025).values()]).not.toContain('国民の休日');
    });

    it('天皇誕生日は2019年に無く、2018年以前は12/23、2020年以降は2/23', () => {
        expect(getHolidaysOfYear(2018).get('2018-12-23')).toBe('天皇誕生日');
        expect([...getHolidaysOfYear(2019).values()]).not.toContain('天皇誕生日');
        expect(getHolidaysOfYear(2020).get('2020-02-23')).toBe('天皇誕生日');
    });

    it('五輪特措法で動いた2021年の海の日・スポーツの日・山の日', () => {
        const h = getHolidaysOfYear(2021);
        expect(h.get('2021-07-22')).toBe('海の日');
        expect(h.get('2021-07-23')).toBe('スポーツの日');
        expect(h.get('2021-08-08')).toBe('山の日');
        expect(h.get('2021-08-09')).toBe('振替休日');
    });
});

describe('単日の判定', () => {
    it('祝日名を返す', () => {
        expect(getJapaneseHolidayName(new Date(2026, 0, 1))).toBe('元日');
        expect(getJapaneseHolidayName(new Date(2026, 8, 22))).toBe('国民の休日');
    });

    it('祝日でない日は null / false', () => {
        expect(getJapaneseHolidayName(new Date(2026, 0, 2))).toBeNull();
        expect(isJapaneseHoliday(new Date(2026, 0, 2))).toBe(false);
    });

    it('土日は（祝日でなければ）祝日扱いしない', () => {
        // 2026-09-05 は土曜
        expect(new Date(2026, 8, 5).getDay()).toBe(6);
        expect(isJapaneseHoliday(new Date(2026, 8, 5))).toBe(false);
    });
});
