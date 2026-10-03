import {
    buildDefaultItems,
    buildStatementNo,
    computeJoyoTotals,
    countJoyoDays,
    daysInMonth,
    defaultIssueDate,
    defaultPaymentDate,
    defaultSubject,
    formatQuantity,
    hasDuplicateAutoKinds,
    itemAmount,
    JOYO_LIMITS,
    paidDaysChanged,
    periodLabel,
    recalcItems,
    roundQuantity,
    syncItemsWithCounts,
    toReiwaYmd,
    type JoyoAttendanceRecord,
    type JoyoStatementItem,
} from '@/lib/joyoStatement';

/** 'PPH-…'（1文字=1日。P=出勤 H=休日 W=休日出勤 N=夜勤 A=欠勤 L=有給 C=代休 -=記録なし）からレコードを作る */
function recordsOf(ym: string, pattern: string): JoyoAttendanceRecord[] {
    const map: Record<string, string> = {
        P: 'present',
        H: 'holiday',
        W: 'holiday_work',
        N: 'night_shift',
        A: 'absent',
        L: 'paid_leave',
        C: 'compensatory_holiday',
    };
    const out: JoyoAttendanceRecord[] = [];
    [...pattern].forEach((ch, i) => {
        if (ch === '-') return;
        // API が返す形（ISO 文字列）で渡す
        out.push({ date: `${ym}-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, status: map[ch] });
    });
    return out;
}

describe('countJoyoDays', () => {
    it('出勤・休日を数え、記録の無い日曜は「記録なし」に入れない', () => {
        // 2026-08: 日曜は 2,9,16,23,30。13〜15日は休日の記録あり
        const c = countJoyoDays(2026, 8, recordsOf('2026-08', 'P-PPPPPP-PPPHHH-PPPPPP-PPPPPP-P'));
        expect(c.present).toBe(23);
        expect(c.holiday).toBe(3);
        expect(c.holidayWork).toBe(0);
        expect(c.nightShift).toBe(0);
        expect(c.missingDays).toEqual([]);
    });

    it('月〜土で記録の無い日を missingDays に出す（2026-04-11 は土曜）', () => {
        const c = countJoyoDays(2026, 4, recordsOf('2026-04', 'PPPP-PPPPP--PPPPPP-PPPPPP-PPPP'));
        expect(c.present).toBe(25);
        expect(c.missingDays).toEqual(['2026-04-11']);
    });

    it('休日出勤・夜勤・欠勤・有給・代休を区分ごとに数える', () => {
        const c = countJoyoDays(2026, 9, recordsOf('2026-09', 'PWNALCH'));
        expect(c).toMatchObject({
            present: 1,
            holidayWork: 1,
            nightShift: 1,
            absent: 1,
            paidLeave: 1,
            compensatoryHoliday: 1,
            holiday: 1,
        });
    });

    it('today 当日と、それより後の日は「記録なし」に数えない（月の途中で開いたとき）', () => {
        // 2026-10-01(木)・02(金) だけ記録あり。今日が 10/6(火) なら、3(土)・5(月) が記録なし（4 は日曜・6 は当日）
        const c = countJoyoDays(2026, 10, recordsOf('2026-10', 'PP'), '2026-10-06');
        expect(c.present).toBe(2);
        expect(c.missingDays).toEqual(['2026-10-03', '2026-10-05']);
        // 今日が 10/3(土) なら、当日はまだ入力前かもしれないので出さない
        expect(countJoyoDays(2026, 10, recordsOf('2026-10', 'PP'), '2026-10-03').missingDays).toEqual([]);
    });

    it('ほかの月のレコードが混ざっていても数えない', () => {
        const c = countJoyoDays(2026, 8, [
            { date: '2026-07-31', status: 'present' },
            { date: '2026-08-01', status: 'present' },
            { date: '2026-09-01', status: 'present' },
        ]);
        expect(c.present).toBe(1);
    });
});

describe('明細行と合計', () => {
    it('出勤の日数 × 単価の1行を作る（23日 × 20,000 = 460,000・内消費税 41,818）', () => {
        const c = countJoyoDays(2026, 8, recordsOf('2026-08', 'P-PPPPPP-PPPHHH-PPPPPP-PPPPPP-P'));
        const items = buildDefaultItems(c, 20000);
        expect(items).toEqual([
            { kind: 'full', name: '常用（全日）', quantity: 23, unit: '日', unitPrice: 20000, amount: 460000, note: '' },
        ]);
        expect(computeJoyoTotals(items)).toEqual({ total: 460000, tax: 41818 });
    });

    it('休日出勤・夜勤がある月は行を分ける。0日でも「常用（全日）」の行は出す', () => {
        const items = buildDefaultItems(countJoyoDays(2026, 9, recordsOf('2026-09', 'WWN')), 15000);
        expect(items.map((i) => [i.kind, i.name, i.quantity, i.amount])).toEqual([
            ['full', '常用（全日）', 0, 0],
            ['holiday_work', '常用（休日出勤）', 2, 30000],
            ['night_shift', '常用（夜勤）', 1, 15000],
        ]);
    });

    it('数量は小数を許し、金額は円単位に四捨五入する', () => {
        expect(itemAmount(24.5, 20000)).toBe(490000);
        expect(itemAmount(0.5, 15001)).toBe(7501); // 7500.5 → 四捨五入
        expect(itemAmount(0.25, 15001)).toBe(3750); // 3750.25 → 四捨五入
        expect(itemAmount(1, -10000)).toBe(-10000);
        expect(itemAmount(Number.NaN, 100)).toBe(0);
    });

    it('浮動小数の誤差で四捨五入を間違えない・マイナスも同じ大きさ・-0 を返さない', () => {
        // 0.47 × 17,350 = 8154.5 ちょうど。そのまま掛けると 8154.4999… になり 8154 に落ちる
        expect(itemAmount(0.47, 17350)).toBe(8155);
        expect(itemAmount(1.15, 50)).toBe(58); // 57.5 → 58
        expect(itemAmount(0.5, -15001)).toBe(-7501);
        expect(itemAmount(0.5, 15001) + itemAmount(0.5, -15001)).toBe(0);
        expect(Object.is(itemAmount(0, -10000), 0)).toBe(true);
    });

    it('数量は小数第2位に丸める', () => {
        expect(roundQuantity(22.504)).toBe(22.5);
        expect(roundQuantity(0.005)).toBe(0.01);
        expect(roundQuantity(Number.NaN)).toBe(0);
        expect(recalcItems([{ kind: 'manual', name: 'x', quantity: 1.004, unit: '式', unitPrice: 1000, note: '' }])).toEqual([
            { kind: 'manual', name: 'x', quantity: 1, unit: '式', unitPrice: 1000, amount: 1000, note: '' },
        ]);
    });

    it('内消費税は 合計×10/110 の円未満切り捨て。差し引く行（マイナス）も合計に入る', () => {
        expect(computeJoyoTotals([{ amount: 110 }])).toEqual({ total: 110, tax: 10 });
        expect(computeJoyoTotals([{ amount: 330000 }])).toEqual({ total: 330000, tax: 30000 });
        expect(computeJoyoTotals([{ amount: 400000 }, { amount: 10000 }, { amount: 3850 }, { amount: -10000 }])).toEqual({
            total: 403850,
            tax: 36713,
        });
        expect(computeJoyoTotals([])).toEqual({ total: 0, tax: 0 });
    });
});

describe('出勤簿の日数に合わせる', () => {
    const base: JoyoStatementItem[] = [
        { kind: 'full', name: '常用（全日）', quantity: 22.5, unit: '日', unitPrice: 20000, amount: 450000, note: '18日は半日' },
        { kind: 'holiday_work', name: '常用（休日出勤）', quantity: 1, unit: '日', unitPrice: 25000, amount: 25000, note: '' },
        { kind: 'manual', name: '立替金', quantity: 1, unit: '式', unitPrice: 3850, amount: 3850, note: '' },
    ];

    it('出勤簿の行は数量だけ入れ直し、単価・備考・手で足した行は残す', () => {
        const counts = countJoyoDays(2026, 9, recordsOf('2026-09', 'PPPWW'));
        const out = syncItemsWithCounts(base, counts, 21000);
        expect(out.map((i) => [i.kind, i.quantity, i.unitPrice, i.amount, i.note])).toEqual([
            ['full', 3, 20000, 60000, '18日は半日'],
            ['holiday_work', 2, 25000, 50000, ''],
            ['manual', 1, 3850, 3850, ''],
        ]);
    });

    it('0日になった休日出勤の行は消し、新しく出てきた夜勤の行は今の単価で足す', () => {
        const counts = countJoyoDays(2026, 9, recordsOf('2026-09', 'PN'));
        const out = syncItemsWithCounts(base, counts, 21000);
        expect(out.map((i) => [i.kind, i.quantity, i.unitPrice])).toEqual([
            ['full', 1, 20000],
            ['night_shift', 1, 21000],
            ['manual', 1, 3850],
        ]);
    });

    it('保存時と今の日数を見比べる（休日の日数だけ変わっても「変わった」にしない）', () => {
        const saved = { present: 23, holidayWork: 0, nightShift: 0 };
        expect(paidDaysChanged(saved, { present: 23, holidayWork: 0, nightShift: 0 })).toBe(false);
        expect(paidDaysChanged(saved, { present: 24, holidayWork: 0, nightShift: 0 })).toBe(true);
        expect(paidDaysChanged(saved, { present: 23, holidayWork: 1, nightShift: 0 })).toBe(true);
        expect(paidDaysChanged(null, { present: 23, holidayWork: 0, nightShift: 0 })).toBe(false);
    });

    it('recalcItems は画面から来た金額を捨てて 数量×単価 で入れ直す', () => {
        const out = recalcItems([{ ...base[0], amount: 999 }]);
        expect(out[0].amount).toBe(450000);
    });

    it('出勤簿の行は種類ごとに1行まで（2行あれば hasDuplicateAutoKinds が true）', () => {
        expect(hasDuplicateAutoKinds(base)).toBe(false);
        expect(hasDuplicateAutoKinds([...base, { kind: 'manual' }, { kind: 'manual' }])).toBe(false);
        expect(hasDuplicateAutoKinds([...base, { kind: 'full' }])).toBe(true);
    });

    it('上限の数字（PDF の行数と同じ値を使う）', () => {
        expect(JOYO_LIMITS.maxItems).toBe(16);
        // 1行の最大（999 × 999,999）× 行数 は INTEGER を超えるので、合計の上限を別に持つ
        expect(JOYO_LIMITS.maxTotal).toBeLessThan(2 ** 31);
    });
});

describe('日付と表記', () => {
    it('発行日の既定は対象月の末日、支払日の既定は翌月10日', () => {
        expect(defaultIssueDate(2026, 8)).toBe('2026-08-31');
        expect(defaultIssueDate(2026, 9)).toBe('2026-09-30');
        expect(defaultIssueDate(2028, 2)).toBe('2028-02-29');
        expect(defaultPaymentDate(2026, 8)).toBe('2026-09-10');
        expect(defaultPaymentDate(2026, 12)).toBe('2027-01-10');
        expect(daysInMonth(2027, 2)).toBe(28);
    });

    it('和暦の表記', () => {
        expect(toReiwaYmd('2026-08-31')).toBe('令和8年8月31日');
        expect(toReiwaYmd('2026-09-10T00:00:00.000Z')).toBe('令和8年9月10日');
        expect(toReiwaYmd('2019-05-01')).toBe('令和元年5月1日');
        expect(toReiwaYmd('2019-04-30')).toBe('2019年4月30日');
        expect(toReiwaYmd('x')).toBe('x');
    });

    it('件名・対象期間・書類番号・数量の表示', () => {
        expect(defaultSubject(2026, 8)).toBe('令和8年8月分 常用代金');
        expect(periodLabel(2026, 8)).toBe('令和8年8月1日 〜 令和8年8月31日');
        expect(buildStatementNo(2026, 8, 1)).toBe('202608-01');
        expect(buildStatementNo(2026, 12, 12)).toBe('202612-12');
        expect(formatQuantity(23)).toBe('23');
        expect(formatQuantity(24.5)).toBe('24.5');
        expect(formatQuantity(0.25)).toBe('0.25');
    });
});
