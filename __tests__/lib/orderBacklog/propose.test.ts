import {
    dueYmFor,
    isWorkFinished,
    proposeProgressRate,
    proposeSchedule,
    proposeStartEndYm,
    type ProposeAssignment,
} from '@/lib/orderBacklog/propose';

const a = (date: string, constructionType: string | null = null): ProposeAssignment => ({ date, constructionType });

describe('isWorkFinished', () => {
    const ASOF = '2026-06-01';

    it('基準日までの配置が無ければ終わっていない（未着工）', () => {
        expect(isWorkFinished([], ASOF)).toBe(false);
        expect(isWorkFinished([a('2026-06-10', '組立')], ASOF)).toBe(false);
    });

    it('基準日より後に予定が残っていれば終わっていない（解体済みでも次の組立があれば続いている）', () => {
        expect(isWorkFinished([a('2026-05-10', '組立'), a('2026-07-20', '解体')], ASOF)).toBe(false);
        expect(isWorkFinished([a('2026-05-10', '組立'), a('2026-05-20', '解体'), a('2026-07-01', '組立')], ASOF)).toBe(false);
    });

    it('解体まで済んで先の予定が無ければ終わっている', () => {
        expect(isWorkFinished([a('2026-05-10', '組立'), a('2026-05-20', '解体')], ASOF)).toBe(true);
        // 基準日当日の解体も「済み」
        expect(isWorkFinished([a('2026-05-10', '組立'), a('2026-06-01', '解体')], ASOF)).toBe(true);
        // 種別名が「組立(解体)」のような複合名でも拾う
        expect(isWorkFinished([a('2026-05-10', '組立(解体)')], ASOF)).toBe(true);
    });

    it('組立だけ済んで解体が未定なら終わっていない（足場が立ったまま）', () => {
        expect(isWorkFinished([a('2026-05-10', '組立')], ASOF)).toBe(false);
        expect(isWorkFinished([a('2026-01-10', '組立')], ASOF)).toBe(false);
    });

    it('組立/解体の区別が無い単発作業は全部過去なら終わっている', () => {
        expect(isWorkFinished([a('2026-05-10', null)], ASOF)).toBe(true);
        expect(isWorkFinished([a('2026-05-10', '養生'), a('2026-05-11', '養生')], ASOF)).toBe(true);
        expect(isWorkFinished([a('2026-05-10', '養生'), a('2026-06-11', '養生')], ASOF)).toBe(false);
    });
});

describe('proposeProgressRate', () => {
    const ASOF = '2026-06-01';

    it('基準日までに1日も入っていなければ0', () => {
        expect(proposeProgressRate([a('2026-06-10', '組立'), a('2026-08-20', '解体')], ASOF)).toBe(0);
        expect(proposeProgressRate([], ASOF)).toBe(0);
    });

    it('解体まで済んで先の予定が無ければ100', () => {
        expect(proposeProgressRate([a('2026-05-10', '組立'), a('2026-05-20', '解体')], ASOF)).toBe(100);
        expect(proposeProgressRate([a('2026-05-10', null)], ASOF)).toBe(100);
    });

    it('解体が済んでいても次の組立が残っていれば50（工事全体としては途中）', () => {
        expect(proposeProgressRate([a('2026-05-10', '組立'), a('2026-05-20', '解体'), a('2026-07-01', '組立')], ASOF)).toBe(50);
    });

    it('組立だけ済んで解体が未定なら50（足場が立ったまま＝終わっていない）', () => {
        expect(proposeProgressRate([a('2026-05-10', '組立')], ASOF)).toBe(50);
    });

    it('着工済みで先の予定が残っていれば50', () => {
        expect(proposeProgressRate([a('2026-05-10', '組立'), a('2026-07-20', '解体')], ASOF)).toBe(50);
    });

    it('基準日当日の配置は「済み」として数える', () => {
        expect(proposeProgressRate([a('2026-06-01', '組立')], ASOF)).toBe(50);
        expect(proposeProgressRate([a('2026-05-01', '組立'), a('2026-06-01', '解体')], ASOF)).toBe(100);
    });
});

describe('proposeStartEndYm', () => {
    it('最初と最後の配置の年月を返す', () => {
        expect(proposeStartEndYm([a('2026-08-20'), a('2026-05-10'), a('2026-06-30')]))
            .toEqual({ startYm: '2026-05', endYm: '2026-08' });
    });

    it('配置が1件なら完成予定は空欄', () => {
        expect(proposeStartEndYm([a('2026-05-10')])).toEqual({ startYm: '2026-05', endYm: null });
    });

    it('配置が無ければ両方空欄', () => {
        expect(proposeStartEndYm([])).toEqual({ startYm: null, endYm: null });
    });
});

describe('dueYmFor', () => {
    it('末締め＋翌月末（既定）', () => {
        expect(dueYmFor('2026-06-10', 0, 'nextMonthEnd')).toBe('2026-07');
        expect(dueYmFor('2026-06-30', 0, 'nextMonthEnd')).toBe('2026-07');
    });

    it('入金サイト未設定は翌月末として扱う', () => {
        expect(dueYmFor('2026-06-10', 0, null)).toBe('2026-07');
        expect(dueYmFor('2026-06-10', null, undefined)).toBe('2026-07');
    });

    it('15日締め＋翌々月10日', () => {
        expect(dueYmFor('2026-06-15', 15, 'secondMonth10')).toBe('2026-08');
    });

    it('締め日を過ぎた作業は翌月締め＝入金も1ヶ月ずれる', () => {
        expect(dueYmFor('2026-06-16', 15, 'secondMonth10')).toBe('2026-09');
        expect(dueYmFor('2026-06-20', 15, 'nextMonthEnd')).toBe('2026-08');
    });

    it('翌々月15日', () => {
        expect(dueYmFor('2026-06-05', 5, 'secondMonth15')).toBe('2026-08');
        expect(dueYmFor('2026-06-06', 5, 'secondMonth15')).toBe('2026-09');
    });

    it('年をまたぐ', () => {
        expect(dueYmFor('2026-12-20', 0, 'nextMonthEnd')).toBe('2027-01');
        expect(dueYmFor('2026-12-20', 15, 'secondMonth10')).toBe('2027-03');
    });
});

describe('proposeSchedule', () => {
    const base = {
        contractAmount: 10000000,
        receivedAmount: 0,
        closingDay: 0,
        preset: 'nextMonthEnd' as const,
        asOf: '2026-06-01',
    };

    it('組立月60%・解体月40%で振る', () => {
        expect(
            proposeSchedule({
                ...base,
                assignments: [a('2026-06-05', '組立'), a('2026-08-20', '解体')],
            }),
        ).toEqual({ '2026-07': 6000000, '2026-09': 4000000 });
    });

    it('割合は指定できる（50/50）', () => {
        expect(
            proposeSchedule({
                ...base,
                assignments: [a('2026-06-05', '組立'), a('2026-08-20', '解体')],
                assemblyShare: 50,
            }),
        ).toEqual({ '2026-07': 5000000, '2026-09': 5000000 });
    });

    it('解体が無ければ100%を組立月の入金月へ', () => {
        expect(
            proposeSchedule({ ...base, assignments: [a('2026-06-05', '組立')] }),
        ).toEqual({ '2026-07': 10000000 });
    });

    it('組立・解体の種別が無ければ最初と最後の配置で振る', () => {
        expect(
            proposeSchedule({
                ...base,
                assignments: [a('2026-08-20', 'その他'), a('2026-06-05', 'その他')],
            }),
        ).toEqual({ '2026-07': 6000000, '2026-09': 4000000 });
    });

    it('組立と解体の入金月が同じなら分けない', () => {
        expect(
            proposeSchedule({
                ...base,
                assignments: [a('2026-06-05', '組立'), a('2026-06-20', '解体')],
            }),
        ).toEqual({ '2026-07': 10000000 });
    });

    it('既受領は早い口から差し引く', () => {
        expect(
            proposeSchedule({
                ...base,
                receivedAmount: 7000000,
                assignments: [a('2026-06-05', '組立'), a('2026-08-20', '解体')],
            }),
        ).toEqual({ '2026-09': 3000000 });
    });

    it('既受領が全額以上なら空', () => {
        expect(
            proposeSchedule({
                ...base,
                receivedAmount: 10000000,
                assignments: [a('2026-06-05', '組立'), a('2026-08-20', '解体')],
            }),
        ).toEqual({});
    });

    it('端数は最後の口に寄せて合計＝契約額−既受領になる', () => {
        const schedule = proposeSchedule({
            ...base,
            contractAmount: 10000001,
            assignments: [a('2026-06-05', '組立'), a('2026-08-20', '解体')],
        });
        expect(schedule).toEqual({ '2026-07': 6000001, '2026-09': 4000000 });
        expect(Object.values(schedule).reduce((s, v) => s + v, 0)).toBe(10000001);
    });

    it('基準月より前の入金月は第1列（基準月）に寄せる', () => {
        expect(
            proposeSchedule({
                ...base,
                asOf: '2026-10-01',
                assignments: [a('2026-06-05', '組立'), a('2026-08-20', '解体')],
            }),
        ).toEqual({ '2026-10': 10000000 });
    });

    it('基準月+8以降は later（+7 までは月のまま）', () => {
        // 解体 2026-12-20 → 入金 2027-01（基準月+7）
        expect(
            proposeSchedule({
                ...base,
                assignments: [a('2026-06-05', '組立'), a('2026-12-20', '解体')],
            }),
        ).toEqual({ '2026-07': 6000000, '2027-01': 4000000 });

        // 解体 2027-01-20 → 入金 2027-02（基準月+8）＝later
        expect(
            proposeSchedule({
                ...base,
                assignments: [a('2026-06-05', '組立'), a('2027-01-20', '解体')],
            }),
        ).toEqual({ '2026-07': 6000000, later: 4000000 });
    });

    it('配置が無い・契約額0なら空', () => {
        expect(proposeSchedule({ ...base, assignments: [] })).toEqual({});
        expect(
            proposeSchedule({ ...base, contractAmount: 0, assignments: [a('2026-06-05', '組立')] }),
        ).toEqual({});
    });

    it('締め日と入金サイトが入金月に反映される', () => {
        expect(
            proposeSchedule({
                ...base,
                closingDay: 15,
                preset: 'secondMonth10',
                assignments: [a('2026-06-20', '組立')],
            }),
        ).toEqual({ '2026-09': 10000000 });
    });
});
