/**
 * 手当の決まりごと（lib/allowances.ts）のテスト。DB にも画面にもつながない純粋関数だけ。
 *
 * いちばん守りたい約束:
 *   - 1,500円（職長の金額）は「その日、対象の現場の手配で職長になっている人」。役職が職長でも、ほかの人の班に入っただけの日は職長以外。
 *     どの画面で付けても同じ（押した画面ではなく、その日の手配で決まる）
 *   - 「出勤簿入力」のボタンと「手配と見比べる」は、同じ手配から、同じ人・同じ区分を出す（2つの画面で決まりが食い違わない）
 *   - 金額は「記録の日付に有効な金額」。手当が始まる前の日付（いちばん古い適用開始日より前）には金額が無い＝付けられない
 *   - 金額は過去の日付からも変えられるが、手当の始まりの日より前には動かせない。その月からあとに締めた月があれば変えられない。
 *     変えたら、すでに付いている記録も、新しい金額の表に合わせる
 *   - 合計は、記録に入っている金額の足し算（確認待ちは入れない）
 *   - 締めた月は、付けるのも取り消すのも断る
 *   - 自分の分は確認待ち。自分では認められない・確定した自分の分は自分では消せない
 */
import {
    ALLOWANCE_AMOUNT_MAX,
    ALLOWANCE_AMOUNT_MIN,
    ALLOWANCE_BULK_MAX,
    ALLOWANCE_CLOSED_MESSAGE,
    ALLOWANCE_DESCRIPTION_MAX,
    ALLOWANCE_INACTIVE_MESSAGE,
    ALLOWANCE_NAME_MAX,
    ALLOWANCE_NO_RATE_MESSAGE,
    ALLOWANCE_NOTE_MAX,
    ALLOWANCE_WORKED_STATUSES,
    ALLOWANCES_UPDATED_EVENT,
    allowanceRateStateOf,
    allowanceStartDateKey,
    amountOf,
    buildAllowanceLines,
    buildExpectedEntries,
    buildTargetRoles,
    canConfirmRecord,
    canEditRecordAmount,
    canInputAllowances,
    canInputForForeman,
    canRemoveRecord,
    checkCanAddRate,
    checkCanCloseMonth,
    dateKeyToDate,
    dateToDateKey,
    dayOffersForCrew,
    decideAllowanceToggle,
    diffExpectedAndRecords,
    entryKey,
    findRecordsToReprice,
    isAllowanceAdmin,
    isAllowanceEligibleRole,
    isAllowanceManager,
    isAllowanceMemberRole,
    isAllowancePayRole,
    isAllowanceRateReplaced,
    isFutureDateKey,
    isMonthEnded,
    isValidAmount,
    isValidMonthKey,
    isWorkedAttendanceStatus,
    jstDateKeyOfInstant,
    monthKeyOf,
    monthRangeOf,
    resolveAllowanceRateAt,
    statusForNewRecord,
    summarizeAllowanceRecords,
    toAllowancePayRole,
    toAllowanceStatus,
    todayJstDateKey,
    type AllowancePayRole,
    type AllowanceRateLike,
    type AllowanceRecordLike,
    type AllowanceToggleInput,
    type CrosscheckAssignment,
    type ExpectedEntry,
} from '@/lib/allowances';
import * as evaluationPoints from '@/lib/evaluationPoints';

const rate = (over: Partial<AllowanceRateLike> = {}): AllowanceRateLike => ({
    id: 'r1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01', createdAt: '2026-10-04T00:00:00.000Z', ...over,
});
const record = (over: Partial<AllowanceRecordLike> = {}): AllowanceRecordLike => ({
    id: 'rec1', userId: 'w1', itemId: 'large', status: 'confirmed', createdBy: 'f1', ...over,
});

/** 手当の対象の工事内容 */
const TARGET = '大規模';
/** 手配の1件（工事内容を渡さなければ、対象の「大規模」の現場） */
const asg = (foremanId: string, dateKey: string, workerIds: string[], content: string | null = TARGET): CrosscheckAssignment =>
    ({ foremanId, dateKey, workerIds, content });

/** 「今」を固定する（Date だけを差し替える。タイマーや Promise の動きは本物のまま）。戻すのは jest.useRealTimers() */
const freezeNow = (iso: string) =>
    jest.useFakeTimers({
        now: new Date(iso),
        doNotFake: [
            'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
            'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
            'setTimeout', 'clearTimeout',
        ],
    });

/** from〜to の毎日（'YYYY-MM-DD'） */
const daysBetween = (from: string, to: string): string[] => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const result: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00.000Z`); t <= Date.parse(`${to}T00:00:00.000Z`); t += DAY_MS) {
        result.push(new Date(t).toISOString().slice(0, 10));
    }
    return result;
};

afterEach(() => {
    jest.useRealTimers();
});

describe('ロールの判定（DB の値は大文字が混ざるので、小文字にそろえて比べる）', () => {
    const cases: [string, boolean, boolean, boolean, boolean, boolean][] = [
        // role,            もらえる, 付けられる, 全員を見る, 本人だけ見る, 管理者
        ['worker',          true,  false, false, true,  false],
        ['foreman1',        true,  true,  false, true,  false],
        ['foreman2',        true,  true,  false, true,  false],
        ['manager',         true,  true,  true,  false, false],
        ['admin',           true,  true,  true,  false, true],
        ['partner',         false, false, false, false, false],
        ['partner_member',  false, false, false, false, false],
        ['accountant',      false, false, false, false, false],
        ['support',         false, false, false, false, false],
        ['',                false, false, false, false, false],
    ];
    it.each(cases)('%s', (role, eligible, input, manager, member, admin) => {
        for (const r of [role, role.toUpperCase()]) {
            expect([isAllowanceEligibleRole(r), canInputAllowances(r), isAllowanceManager(r), isAllowanceMemberRole(r), isAllowanceAdmin(r)])
                .toEqual([eligible, input, manager, member, admin]);
        }
    });

    it('null・undefined は、どの判定も通らない', () => {
        for (const r of [null, undefined]) {
            expect([isAllowanceEligibleRole(r), canInputAllowances(r), isAllowanceManager(r), isAllowanceMemberRole(r), isAllowanceAdmin(r)])
                .toEqual([false, false, false, false, false]);
        }
    });
});

describe('DB の文字列を、決まった値にそろえる', () => {
    it("status: 'pending' だけが確認待ち。知らない値は確定（合計から落とさない）", () => {
        expect(['pending', 'confirmed', 'PENDING', '', 'x', null, undefined].map((v) => toAllowanceStatus(v)))
            .toEqual(['pending', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed']);
    });
    it("payRole: 'foreman' だけが職長。知らない値は職長以外（金額の大きいほうに数えない）", () => {
        expect(['foreman', 'member', 'FOREMAN', '', 'x', null, undefined].map((v) => toAllowancePayRole(v)))
            .toEqual(['foreman', 'member', 'member', 'member', 'member', 'member', 'member']);
    });
    it("入力の payRole は 'foreman' か 'member' だけ", () => {
        expect(['foreman', 'member', 'FOREMAN', '', null, undefined, 1, {}].map((v) => isAllowancePayRole(v)))
            .toEqual([true, true, false, false, false, false, false, false]);
    });
});

describe('日付', () => {
    it("dateKeyToDate: 'YYYY-MM-DD' を UTC 0時の Date にする。形が違う・実在しない日付は null", () => {
        expect(dateKeyToDate('2026-09-30')?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
        expect(dateKeyToDate('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
        for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-9-30', '2026/09/30', '20260930', '', ' 2026-09-30', '2026-09-30T00:00:00Z', null, undefined, 20260930, {}]) {
            expect(dateKeyToDate(bad)).toBeNull();
        }
    });

    it('dateToDateKey: @db.Date の Date（UTC 0時の印）を、そのままの日付にする', () => {
        expect(dateToDateKey(new Date('2026-09-30T00:00:00.000Z'))).toBe('2026-09-30');
    });

    it('todayJstDateKey: 日本時間の今日（UTC では前の日でも、日本時間で日付が変わっていれば新しい日）', () => {
        expect(todayJstDateKey(new Date('2026-09-30T14:59:59.000Z'))).toBe('2026-09-30');
        expect(todayJstDateKey(new Date('2026-09-30T15:00:00.000Z'))).toBe('2026-10-01');
        expect(todayJstDateKey(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01');
    });

    it('isFutureDateKey: 今日は先の日付でない。明日からが先の日付', () => {
        expect([isFutureDateKey('2026-09-30', '2026-10-01'), isFutureDateKey('2026-10-01', '2026-10-01'), isFutureDateKey('2026-10-02', '2026-10-01')])
            .toEqual([false, false, true]);
    });

    it('jstDateKeyOfInstant: 手配の日時（JST 0時 = UTC 前日15時）を、日本時間の日付にする', () => {
        expect(jstDateKeyOfInstant(new Date('2026-08-31T15:00:00.000Z'))).toBe('2026-09-01'); // 9/1 の手配
        expect(jstDateKeyOfInstant(new Date('2026-09-30T14:59:59.999Z'))).toBe('2026-09-30'); // 9/30 の終わり
        expect(jstDateKeyOfInstant(new Date('2026-09-30T15:00:00.000Z'))).toBe('2026-10-01'); // 10/1 の手配
        expect(jstDateKeyOfInstant(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01');
    });

    it('日付の部品は、評価ポイント（lib/evaluationPoints.ts）の同じ名前の関数と同じ答えを返す', () => {
        for (const v of ['2026-09-30', '2024-02-29', '2026-02-30', '2026-13-01', '2026-9-3', '', 'x', null, undefined, 5]) {
            expect(dateKeyToDate(v)?.toISOString() ?? null).toBe(evaluationPoints.dateKeyToDate(v)?.toISOString() ?? null);
        }
        for (const iso of ['2026-09-30T14:59:59.000Z', '2026-09-30T15:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-12-31T15:00:00.000Z']) {
            expect(todayJstDateKey(new Date(iso))).toBe(evaluationPoints.todayJstDateKey(new Date(iso)));
        }
        expect(dateToDateKey(new Date('2026-09-30T00:00:00.000Z'))).toBe(evaluationPoints.dateToDateKey(new Date('2026-09-30T00:00:00.000Z')));
        expect(isFutureDateKey('2026-10-02', '2026-10-01')).toBe(evaluationPoints.isFutureDateKey('2026-10-02', '2026-10-01'));
    });

    it('「今日」を渡さなければ、日本時間の今日で決める（UTC ではまだ前の日でも、日本時間で日付が変わっていれば新しい日）', () => {
        const r = rate({ id: 'r1', effectiveFrom: '2026-11-01' });

        freezeNow('2026-10-31T15:30:00.000Z'); // 日本時間 11/1 0:30（UTC では 10/31）
        expect(todayJstDateKey()).toBe('2026-11-01');
        expect([isFutureDateKey('2026-11-01'), isFutureDateKey('2026-11-02')]).toEqual([false, true]);
        expect([isMonthEnded('2026-10'), isMonthEnded('2026-11')]).toEqual([true, false]);
        expect(checkCanCloseMonth('2026-10', 0)).toEqual({ ok: true });
        // 11/1 は「今日」なので、金額の行が無くても足せる。10/31 は過去
        expect(checkCanAddRate('2026-11-01', [], [])).toEqual({ ok: true });
        expect(checkCanAddRate('2026-10-31', [], [])).toEqual({ ok: false, reason: 'before_start', startDate: null });
        expect(allowanceRateStateOf(r, [r])).toBe('current');

        freezeNow('2026-10-31T14:59:00.000Z'); // 日本時間 10/31 23:59
        expect(todayJstDateKey()).toBe('2026-10-31');
        expect([isFutureDateKey('2026-10-31'), isFutureDateKey('2026-11-01')]).toEqual([false, true]);
        expect(isMonthEnded('2026-10')).toBe(false);
        expect(checkCanCloseMonth('2026-10', 0)).toEqual({ ok: false, reason: 'not_ended' });
        expect(checkCanAddRate('2026-10-31', [], [])).toEqual({ ok: true });
        expect(checkCanAddRate('2026-10-30', [], [])).toEqual({ ok: false, reason: 'before_start', startDate: null });
        expect(allowanceRateStateOf(r, [r])).toBe('upcoming');
    });
});

describe('月', () => {
    it("isValidMonthKey: 'YYYY-MM'（年は 2000〜2999・月は 01〜12）だけ", () => {
        expect(['2026-09', '2026-01', '2026-12', '2000-01', '2999-12'].map((v) => isValidMonthKey(v))).toEqual([true, true, true, true, true]);
        for (const bad of ['2026-00', '2026-13', '2026-9', '202609', '2026-09-01', '', ' 2026-09', null, undefined, 202609]) {
            expect(isValidMonthKey(bad)).toBe(false);
        }
        // '0026-09' は、Date が 1926年と読んでしまうので受け付けない（1999年より前・3000年より後も）
        for (const bad of ['0026-09', '0000-01', '1999-12', '3000-01', '9999-12']) {
            expect(isValidMonthKey(bad)).toBe(false);
            expect(monthRangeOf(bad)).toBeNull();
        }
    });

    it('monthKeyOf: 日付の月', () => {
        expect(monthKeyOf('2026-09-30')).toBe('2026-09');
    });

    it('monthRangeOf: 月の1日〜末日・@db.Date の列を絞る範囲・手配（時刻つき）を日本時間の月で絞る範囲', () => {
        const r = monthRangeOf('2026-09');
        expect(r).not.toBeNull();
        expect([r?.startKey, r?.endKey]).toEqual(['2026-09-01', '2026-09-30']);
        expect([r?.dateRange.gte.toISOString(), r?.dateRange.lt.toISOString()]).toEqual(['2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z']);
        // 9/1 の手配は UTC 8/31 15:00、10/1 の手配は UTC 9/30 15:00
        expect([r?.instantRange.gte.toISOString(), r?.instantRange.lt.toISOString()]).toEqual(['2026-08-31T15:00:00.000Z', '2026-09-30T15:00:00.000Z']);
    });

    it('monthRangeOf: 2月（うるう年）・12月（年をまたぐ）', () => {
        expect(monthRangeOf('2024-02')?.endKey).toBe('2024-02-29');
        expect(monthRangeOf('2026-02')?.endKey).toBe('2026-02-28');
        const dec = monthRangeOf('2026-12');
        expect([dec?.startKey, dec?.endKey, dec?.dateRange.lt.toISOString(), dec?.instantRange.lt.toISOString()])
            .toEqual(['2026-12-01', '2026-12-31', '2027-01-01T00:00:00.000Z', '2026-12-31T15:00:00.000Z']);
    });

    it('monthRangeOf: 形が違えば null', () => {
        for (const bad of ['2026-13', '2026-9', '', null, undefined, 202609]) expect(monthRangeOf(bad)).toBeNull();
    });

    it('手配の日時の範囲と、jstDateKeyOfInstant は同じ月を指す（範囲の最初と、最後の1ミリ秒前）', () => {
        const r = monthRangeOf('2026-09');
        expect(r).not.toBeNull();
        if (!r) return;
        expect(jstDateKeyOfInstant(r.instantRange.gte)).toBe('2026-09-01');
        expect(jstDateKeyOfInstant(new Date(r.instantRange.lt.getTime() - 1))).toBe('2026-09-30');
        expect(jstDateKeyOfInstant(r.instantRange.lt)).toBe('2026-10-01');
        expect(jstDateKeyOfInstant(new Date(r.instantRange.gte.getTime() - 1))).toBe('2026-08-31');
    });

    it('isMonthEnded: 今日の月より前の月だけが「終わった月」', () => {
        expect([isMonthEnded('2026-09', '2026-10-01'), isMonthEnded('2026-10', '2026-10-01'), isMonthEnded('2026-10', '2026-10-31'), isMonthEnded('2026-11', '2026-10-31'), isMonthEnded('2025-12', '2026-01-01')])
            .toEqual([true, false, false, false, true]);
    });
});

describe('金額', () => {
    it('isValidAmount: 0〜100000 の整数だけ', () => {
        expect([0, 200, 1500, ALLOWANCE_AMOUNT_MAX].map((v) => isValidAmount(v))).toEqual([true, true, true, true]);
        for (const bad of [-1, ALLOWANCE_AMOUNT_MAX + 1, 1.5, NaN, Infinity, '200', null, undefined, {}]) expect(isValidAmount(bad)).toBe(false);
    });

    it('amountOf: 職長は職長の金額、職長以外は職長以外の金額', () => {
        expect([amountOf(rate(), 'foreman'), amountOf(rate(), 'member')]).toEqual([1500, 200]);
    });

    describe('resolveAllowanceRateAt（その日付の記録に使う金額の行）', () => {
        const r1 = rate({ id: 'r1', effectiveFrom: '2026-09-01', createdAt: '2026-10-04T00:00:00.000Z' });
        const r2 = rate({ id: 'r2', foremanAmount: 2000, memberAmount: 300, effectiveFrom: '2026-11-01', createdAt: '2026-10-20T00:00:00.000Z' });

        it('適用開始日がその日付以前の行のうち、いちばん新しい行', () => {
            expect(resolveAllowanceRateAt([r1, r2], '2026-10-31')?.id).toBe('r1');
            expect(resolveAllowanceRateAt([r1, r2], '2026-11-01')?.id).toBe('r2'); // 適用開始日の当日から新しい金額
            expect(resolveAllowanceRateAt([r2, r1], '2026-12-15')?.id).toBe('r2'); // 並びによらない
        });

        it('どの適用開始日よりも前の日付には、金額が無い（null）＝手当が始まる前の日付には付けられない', () => {
            expect(resolveAllowanceRateAt([r1, r2], '2026-08-31')).toBeNull();
            expect(resolveAllowanceRateAt([r2, r1], '2020-01-01')).toBeNull();
            // 始まりの日（いちばん古い適用開始日）の当日からは、金額がある
            expect(resolveAllowanceRateAt([r2, r1], '2026-09-01')?.id).toBe('r1');
        });

        it('同じ適用開始日が2行あれば、後から入れた行（入れた日時が同じなら id の大きいほう）', () => {
            const a = rate({ id: 'a', foremanAmount: 1000, effectiveFrom: '2026-11-01', createdAt: '2026-10-20T00:00:00.000Z' });
            const b = rate({ id: 'b', foremanAmount: 1800, effectiveFrom: '2026-11-01', createdAt: '2026-10-21T00:00:00.000Z' });
            expect(resolveAllowanceRateAt([a, b], '2026-11-05')?.id).toBe('b');
            expect(resolveAllowanceRateAt([b, a], '2026-11-05')?.id).toBe('b');
            const c = rate({ id: 'c', effectiveFrom: '2026-11-01', createdAt: '2026-10-21T00:00:00.000Z' });
            expect(resolveAllowanceRateAt([b, c], '2026-11-05')?.id).toBe('c');
            expect(resolveAllowanceRateAt([c, b], '2026-11-05')?.id).toBe('c');
            // 適用開始日の当日でも同じ決まり
            expect(resolveAllowanceRateAt([a, b], '2026-11-01')?.id).toBe('b');
            expect(resolveAllowanceRateAt([c, b], '2026-11-01')?.id).toBe('c');
            // 入れた日時が後なら、id が小さくても「後から入れた行」（id を見るのは、入れた日時が同じときだけ）
            const late = rate({ id: '0', effectiveFrom: '2026-11-01', createdAt: '2026-10-22T00:00:00.000Z' });
            expect(resolveAllowanceRateAt([late, b, c], '2026-11-05')?.id).toBe('0');
            expect(resolveAllowanceRateAt([c, b, late], '2026-11-05')?.id).toBe('0');
        });

        it('行が1つも無ければ null', () => {
            expect(resolveAllowanceRateAt([], '2026-09-30')).toBeNull();
        });
    });

    it('allowanceStartDateKey: その手当の始まりの日＝いちばん古い適用開始日（並びによらない）。行が無ければ null', () => {
        const r1 = rate({ id: 'r1', effectiveFrom: '2026-09-01' });
        const r2 = rate({ id: 'r2', effectiveFrom: '2026-11-01' });
        expect([allowanceStartDateKey([r1, r2]), allowanceStartDateKey([r2, r1]), allowanceStartDateKey([r2]), allowanceStartDateKey([])])
            .toEqual(['2026-09-01', '2026-09-01', '2026-11-01', null]);
        // 始まりの日の前の日は金額なし、当日は金額あり（2つの関数が同じ境目を指す）
        expect([resolveAllowanceRateAt([r2, r1], '2026-08-31'), resolveAllowanceRateAt([r2, r1], '2026-09-01')?.id]).toEqual([null, 'r1']);
    });

    it('決まった値（ほかのファイルと、画面の文言が頼っているもの）', () => {
        expect([ALLOWANCE_AMOUNT_MIN, ALLOWANCE_AMOUNT_MAX, ALLOWANCE_NAME_MAX, ALLOWANCE_DESCRIPTION_MAX, ALLOWANCE_NOTE_MAX, ALLOWANCE_BULK_MAX])
            .toEqual([0, 100000, 30, 200, 200, 2000]);
        expect(ALLOWANCES_UPDATED_EVENT).toBe('allowances_updated');
        expect(ALLOWANCE_NO_RATE_MESSAGE).toBe('この日付には、この手当の金額が設定されていません（手当が始まる前の日付には付けられません）');
        expect(ALLOWANCE_CLOSED_MESSAGE).toBe('この月は締めてあります（管理者が締めを外すと、変えられます）');
        expect(ALLOWANCE_INACTIVE_MESSAGE).toBe('この手当は「使わない」になっています（管理者が、設定の「手当」で「使う」にすると、付けられます）');
    });
});

describe('allowanceRateStateOf・isAllowanceRateReplaced（金額の履歴の中で、その行が今どの状態か）', () => {
    const TODAY = '2026-10-04';
    const first = rate({ id: 'r1', effectiveFrom: '2026-09-01', createdAt: '2026-08-20T00:00:00.000Z' });                                              // 9/1 から（以前の金額）
    const now = rate({ id: 'r2', foremanAmount: 1800, memberAmount: 300, effectiveFrom: '2026-10-01', createdAt: '2026-09-25T00:00:00.000Z' });   // 10/1 から（今の金額）
    const next = rate({ id: 'r3', foremanAmount: 2000, memberAmount: 400, effectiveFrom: '2026-11-01', createdAt: '2026-10-02T00:00:00.000Z' });  // 11/1 から（予約）
    const all = [first, now, next];
    const statesAt = (todayKey: string, rates: AllowanceRateLike[] = all) => all.map((r) => allowanceRateStateOf(r, rates, todayKey));

    it('予約（適用開始日が今日より後）は upcoming、今日の記録に使う行は current、それより前の行は past（履歴の並びによらない）', () => {
        expect(statesAt(TODAY)).toEqual(['past', 'current', 'upcoming']);
        expect(statesAt(TODAY, [next, first, now])).toEqual(['past', 'current', 'upcoming']);
        // どの行も「置きかえられた行」ではない（適用開始日が違う行は、あとから入れた行でも関係ない）
        expect(all.map((r) => isAllowanceRateReplaced(r, all))).toEqual([false, false, false]);
    });

    it('境目: 適用開始日が今日ちょうどの行は current（その日から使う）。明日からの行は upcoming', () => {
        expect(statesAt('2026-09-30')).toEqual(['current', 'upcoming', 'upcoming']);
        expect(statesAt('2026-10-01')).toEqual(['past', 'current', 'upcoming']);
        expect(statesAt('2026-10-31')).toEqual(['past', 'current', 'upcoming']);
        expect(statesAt('2026-11-01')).toEqual(['past', 'past', 'current']);
    });

    it('今日が、手当の始まりの日より前なら、全部の行が upcoming（current は無い）', () => {
        expect(statesAt('2026-08-31')).toEqual(['upcoming', 'upcoming', 'upcoming']);
        expect(statesAt('2026-09-01')).toEqual(['current', 'upcoming', 'upcoming']);
    });

    it('同じ適用開始日の2行（打ちまちがいの入れ直し）: あとから入れた行が current、古いほうは past で「置きかえられた行」', () => {
        const typo = rate({ id: 'a', foremanAmount: 15000, effectiveFrom: '2026-10-01', createdAt: '2026-09-25T00:00:00.000Z' });
        const fixed = rate({ id: 'b', foremanAmount: 1500, effectiveFrom: '2026-10-01', createdAt: '2026-10-02T00:00:00.000Z' });
        for (const rates of [[first, typo, fixed], [fixed, typo, first]]) {
            expect([first, typo, fixed].map((r) => allowanceRateStateOf(r, rates, TODAY))).toEqual(['past', 'past', 'current']);
            expect([first, typo, fixed].map((r) => isAllowanceRateReplaced(r, rates))).toEqual([false, true, false]);
        }
    });

    it('入れた日時も同じで、ID だけが違う2行: ID の大きいほうが current、小さいほうが past で「置きかえられた行」', () => {
        const a = rate({ id: 'a', effectiveFrom: '2026-10-01', createdAt: '2026-09-25T00:00:00.000Z' });
        const b = rate({ id: 'b', effectiveFrom: '2026-10-01', createdAt: '2026-09-25T00:00:00.000Z' });
        for (const rates of [[a, b], [b, a]]) {
            expect([allowanceRateStateOf(a, rates, TODAY), allowanceRateStateOf(b, rates, TODAY)]).toEqual(['past', 'current']);
            expect([isAllowanceRateReplaced(a, rates), isAllowanceRateReplaced(b, rates)]).toEqual([true, false]);
        }
    });

    it('予約が同じ日に2行あれば、どちらも upcoming（古いほうは「置きかえられた行」）', () => {
        const old = rate({ id: 'p1', effectiveFrom: '2026-11-01', createdAt: '2026-10-01T00:00:00.000Z' });
        const redo = rate({ id: 'p2', effectiveFrom: '2026-11-01', createdAt: '2026-10-03T00:00:00.000Z' });
        const rates = [first, old, redo];
        expect([old, redo].map((r) => allowanceRateStateOf(r, rates, TODAY))).toEqual(['upcoming', 'upcoming']);
        expect([old, redo].map((r) => isAllowanceRateReplaced(r, rates))).toEqual([true, false]);
    });

    it('isAllowanceRateReplaced: 自分自身とは比べない（1行だけなら false）。同じ適用開始日が3行あれば、いちばん後から入れた行だけが false', () => {
        expect(isAllowanceRateReplaced(first, [first])).toBe(false);
        expect(isAllowanceRateReplaced(first, [])).toBe(false);
        const x = rate({ id: 'x', effectiveFrom: '2026-10-01', createdAt: '2026-09-01T00:00:00.000Z' });
        const y = rate({ id: 'y', effectiveFrom: '2026-10-01', createdAt: '2026-09-03T00:00:00.000Z' });
        const z = rate({ id: 'z', effectiveFrom: '2026-10-01', createdAt: '2026-09-02T00:00:00.000Z' });
        expect([x, y, z].map((r) => isAllowanceRateReplaced(r, [x, y, z]))).toEqual([true, false, true]);
    });

    it('置きかえられた行は、どの日付の記録にも使われない。置きかえられていない行は、その適用開始日の記録に使われる', () => {
        const rates = [
            rate({ id: 'r1', effectiveFrom: '2026-09-01', createdAt: '2026-08-20T00:00:00.000Z' }),
            rate({ id: 'r1b', effectiveFrom: '2026-09-01', createdAt: '2026-09-10T00:00:00.000Z' }),  // 9/1 の入れ直し
            rate({ id: 'r2', effectiveFrom: '2026-10-01', createdAt: '2026-09-25T00:00:00.000Z' }),
            rate({ id: 'r2b', effectiveFrom: '2026-10-01', createdAt: '2026-09-25T00:00:00.000Z' }),  // 入れた日時も同じ（ID で決まる）
            rate({ id: 'r3', effectiveFrom: '2026-11-01', createdAt: '2026-08-01T00:00:00.000Z' }),   // 先に入れてあった予約
        ];
        const replaced = rates.filter((r) => isAllowanceRateReplaced(r, rates)).map((r) => r.id);
        expect(replaced).toEqual(['r1', 'r2']);

        // 8月の終わり〜11月の毎日について、その日に使う行を引く
        const used = new Set<string>();
        for (const day of daysBetween('2026-08-25', '2026-11-10')) {
            const r = resolveAllowanceRateAt(rates, day);
            if (r) used.add(r.id);
        }
        expect(Array.from(used).sort()).toEqual(['r1b', 'r2b', 'r3']);
        for (const r of rates) {
            expect([r.id, resolveAllowanceRateAt(rates, r.effectiveFrom)?.id === r.id]).toEqual([r.id, !replaced.includes(r.id)]);
        }
    });
});

describe('checkCanAddRate（その適用開始日で、金額の行を足してよいか）', () => {
    const TODAY = '2026-10-04';
    /** 手当の始まりの日は 9/1 */
    const rates = [rate({ id: 'r1', effectiveFrom: '2026-09-01' })];

    it('今日・今日より後の日付は足せる（予約）。金額の行が1つも無い手当でも足せる', () => {
        expect(checkCanAddRate('2026-10-04', rates, [], TODAY)).toEqual({ ok: true });
        expect(checkCanAddRate('2026-10-05', rates, [], TODAY)).toEqual({ ok: true });
        expect(checkCanAddRate('2099-12-31', rates, [], TODAY)).toEqual({ ok: true });
        expect(checkCanAddRate('2026-10-04', [], [], TODAY)).toEqual({ ok: true });
        expect(checkCanAddRate('2026-11-01', [], [], TODAY)).toEqual({ ok: true });
    });

    it('過去の日付は、手当の始まりの日以降のときだけ足せる（始まりの日ちょうどは足せる。その1日前は before_start）', () => {
        expect(checkCanAddRate('2026-10-03', rates, [], TODAY)).toEqual({ ok: true }); // きのう
        expect(checkCanAddRate('2026-09-15', rates, [], TODAY)).toEqual({ ok: true });
        expect(checkCanAddRate('2026-09-01', rates, [], TODAY)).toEqual({ ok: true }); // 始まりの日ちょうど（最初の金額の打ちまちがいを直す）
        expect(checkCanAddRate('2026-08-31', rates, [], TODAY)).toEqual({ ok: false, reason: 'before_start', startDate: '2026-09-01' });
        expect(checkCanAddRate('2025-01-01', rates, [], TODAY)).toEqual({ ok: false, reason: 'before_start', startDate: '2026-09-01' });
    });

    it('始まりの日は、いちばん古い適用開始日（金額の行の並びによらない）', () => {
        const two = [rate({ id: 'r2', effectiveFrom: '2026-10-01' }), rate({ id: 'r1', effectiveFrom: '2026-09-01' })];
        expect(checkCanAddRate('2026-09-01', two, [], TODAY)).toEqual({ ok: true });
        expect(checkCanAddRate('2026-08-31', two, [], TODAY)).toEqual({ ok: false, reason: 'before_start', startDate: '2026-09-01' });
    });

    it('金額の行が1つも無い手当は、過去の日付では足せない（before_start で、startDate は null）', () => {
        expect(checkCanAddRate('2026-10-03', [], [], TODAY)).toEqual({ ok: false, reason: 'before_start', startDate: null });
    });

    it('予約しか無い手当（始まりの日が先）: 今日以降なら、その始まりの日より前でも足せる。過去の日付は足せない', () => {
        const onlyUpcoming = [rate({ id: 'r9', effectiveFrom: '2026-12-01' })];
        expect(checkCanAddRate('2026-10-04', onlyUpcoming, [], TODAY)).toEqual({ ok: true });
        expect(checkCanAddRate('2026-11-01', onlyUpcoming, [], TODAY)).toEqual({ ok: true });
        expect(checkCanAddRate('2026-10-03', onlyUpcoming, [], TODAY)).toEqual({ ok: false, reason: 'before_start', startDate: '2026-12-01' });
    });

    it('締めた月: 適用開始日の月より前の月は関係ない。同じ月・後の月が締めてあれば closed_month', () => {
        expect(checkCanAddRate('2026-09-15', rates, ['2026-08'], TODAY)).toEqual({ ok: true });                                              // 前の月
        expect(checkCanAddRate('2026-09-15', rates, ['2026-09'], TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-09' });  // 同じ月
        expect(checkCanAddRate('2026-09-15', rates, ['2026-10'], TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-10' });  // 後の月
        // 月の境目: 9/30 は9月、10/1 は10月
        expect(checkCanAddRate('2026-09-30', rates, ['2026-09'], TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-09' });
        expect(checkCanAddRate('2026-10-01', rates, ['2026-09'], TODAY)).toEqual({ ok: true });
    });

    it('締めた月が複数あるときは、適用開始日の月からあとの中で、いちばん古い月を返す（並びによらない。前の月は混ざっていても無視する）', () => {
        const longAgo = [rate({ id: 'r0', effectiveFrom: '2025-04-01' })];
        const closed = ['2026-08', '2026-02', '2026-05', '2026-03', '2026-09'];
        expect(checkCanAddRate('2026-03-10', longAgo, closed, TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-03' });
        expect(checkCanAddRate('2026-04-01', longAgo, closed, TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-05' });
        expect(checkCanAddRate('2026-04-01', longAgo, [...closed].reverse(), TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-05' });
        expect(checkCanAddRate('2026-09-30', longAgo, closed, TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-09' });
        expect(checkCanAddRate('2026-10-01', longAgo, closed, TODAY)).toEqual({ ok: true });
        // 年をまたぐ: 前の年の12月から見ると、次の年の1月は「後の月」
        expect(checkCanAddRate('2025-12-15', longAgo, ['2025-11', '2026-01'], TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-01' });
    });

    it('before_start と closed_month の両方に当たるときは、before_start を先に返す', () => {
        expect(checkCanAddRate('2026-08-31', rates, ['2026-08', '2026-09'], TODAY)).toEqual({ ok: false, reason: 'before_start', startDate: '2026-09-01' });
        expect(checkCanAddRate('2026-10-03', [], ['2026-10'], TODAY)).toEqual({ ok: false, reason: 'before_start', startDate: null });
    });

    it('今日以降の日付でも、その月からあとに締めた月があれば足せない', () => {
        expect(checkCanAddRate('2026-10-04', rates, ['2026-10'], TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-10' });
        expect(checkCanAddRate('2026-11-01', rates, ['2026-12'], TODAY)).toEqual({ ok: false, reason: 'closed_month', month: '2026-12' });
        expect(checkCanAddRate('2026-11-01', rates, ['2026-10', '2026-09'], TODAY)).toEqual({ ok: true });
    });
});

describe('findRecordsToReprice（金額を変えたとき、すでに付いている記録を、金額の表に合わせる）', () => {
    const r1 = rate({ id: 'r1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01', createdAt: '2026-08-20T00:00:00.000Z' });
    /** 10/4 に、さかのぼって足した行（9/16 から、職長 1,800円・職長以外 300円） */
    const r2 = rate({ id: 'r2', foremanAmount: 1800, memberAmount: 300, effectiveFrom: '2026-09-16', createdAt: '2026-10-04T00:00:00.000Z' });
    const rec = (id: string, date: string, payRole: AllowancePayRole, amount: number, rateId: string | null) => ({ id, date, payRole, amount, rateId });

    it('金額が、その日付に有効な金額と違う記録を返す（合わせたあとの金額と、金額の行）。合っている記録は返さない', () => {
        const records = [
            rec('a', '2026-09-15', 'member', 200, 'r1'),    // 9/15 は r1 のまま＝合っている
            rec('b', '2026-09-16', 'member', 200, 'r1'),    // 9/16 からは r2 → 300円
            rec('c', '2026-09-16', 'foreman', 1500, 'r1'),  // 職長は 1,800円
            rec('d', '2026-09-30', 'member', 300, 'r2'),    // もう合っている
        ];
        expect(findRecordsToReprice(records, [r1, r2])).toEqual([
            { record: records[1], amount: 300, rateId: 'r2' },
            { record: records[2], amount: 1800, rateId: 'r2' },
        ]);
    });

    it('金額は同じでも、写した金額の行（rateId）が違う記録は返す（金額はそのまま・行だけ付け替える）。rateId が null の記録も', () => {
        // r1 と同じ金額で、同じ適用開始日に入れ直した行
        const r1b = rate({ id: 'r1b', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01', createdAt: '2026-10-04T00:00:00.000Z' });
        const records = [
            rec('e', '2026-09-10', 'member', 200, 'r1'),
            rec('f', '2026-09-10', 'member', 200, null),
            rec('g', '2026-09-10', 'member', 200, 'r1b'),   // 金額も行も合っている
        ];
        expect(findRecordsToReprice(records, [r1, r1b])).toEqual([
            { record: records[0], amount: 200, rateId: 'r1b' },
            { record: records[1], amount: 200, rateId: 'r1b' },
        ]);
        // 金額の表が変わっていなくても、rateId が null の記録には行を入れる
        expect(findRecordsToReprice([records[1]], [r1])).toEqual([{ record: records[1], amount: 200, rateId: 'r1' }]);
        expect(findRecordsToReprice([records[0]], [r1])).toEqual([]);
    });

    it('その日付に有効な金額が無い記録（手当の始まりの日より前）は、金額が違っても返さない', () => {
        const records = [
            rec('x', '2026-08-31', 'member', 999, null),    // 始まりの日の前の日
            rec('y', '2026-09-01', 'member', 999, null),    // 始まりの日ちょうど
        ];
        expect(findRecordsToReprice(records, [r1])).toEqual([{ record: records[1], amount: 200, rateId: 'r1' }]);
    });

    it('職長の記録は職長の金額に、職長以外の記録は職長以外の金額に合わせる', () => {
        const records = [
            rec('h', '2026-09-10', 'foreman', 200, 'r1'),   // 職長なのに、職長以外の金額が入っている
            rec('i', '2026-09-10', 'member', 1500, 'r1'),   // 職長以外なのに、職長の金額が入っている
        ];
        expect(findRecordsToReprice(records, [r1]).map((c) => [c.record.id, c.amount, c.rateId])).toEqual([['h', 1500, 'r1'], ['i', 200, 'r1']]);
    });

    it('月の途中で金額が変わる月は、記録の日付ごとに、その日に有効な行に合わせる（境目: 適用開始日の前の日と当日）', () => {
        const records = [
            rec('j', '2026-09-15', 'member', 0, null),
            rec('k', '2026-09-16', 'member', 0, null),
            rec('l', '2026-09-15', 'foreman', 0, null),
            rec('m', '2026-09-16', 'foreman', 0, null),
        ];
        for (const rates of [[r1, r2], [r2, r1]]) {
            expect(findRecordsToReprice(records, rates).map((c) => [c.record.id, c.amount, c.rateId]))
                .toEqual([['j', 200, 'r1'], ['k', 300, 'r2'], ['l', 1500, 'r1'], ['m', 1800, 'r2']]);
        }
    });

    it('同じ適用開始日で入れ直したとき（打ちまちがいの直し）は、あとから入れた行に合わせる', () => {
        const typo = rate({ id: 'a', foremanAmount: 15000, memberAmount: 200, effectiveFrom: '2026-09-01', createdAt: '2026-08-20T00:00:00.000Z' });
        const fixed = rate({ id: 'b', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01', createdAt: '2026-10-04T00:00:00.000Z' });
        const records = [
            rec('n', '2026-09-05', 'foreman', 15000, 'a'),  // 金額が変わる
            rec('o', '2026-09-05', 'member', 200, 'a'),     // 金額は同じ（行だけ付け替える）
        ];
        expect(findRecordsToReprice(records, [typo, fixed]).map((c) => [c.record.id, c.amount, c.rateId])).toEqual([['n', 1500, 'b'], ['o', 200, 'b']]);
    });

    it('返す record は、渡した記録そのもの（ほかの列もそのまま）。並びは渡した順。渡した記録・金額の行は書き換えない', () => {
        const records = [
            { ...rec('q', '2026-09-20', 'member', 200, 'r1'), userId: 'w2', itemName: '大規模手当' },
            { ...rec('p', '2026-09-16', 'foreman', 1500, 'r1'), userId: 'f1', itemName: '大規模手当' },
        ];
        const rates = [r1, r2];
        const before = JSON.stringify([records, rates]);
        const changes = findRecordsToReprice(records, rates);
        expect(changes.map((c) => c.record.id)).toEqual(['q', 'p']);
        expect(changes[0].record).toBe(records[0]);
        expect(changes[1].record).toBe(records[1]);
        expect(JSON.stringify([records, rates])).toBe(before);
    });

    it('金額の行が1つも無い・記録が無いときは空', () => {
        expect(findRecordsToReprice([rec('z', '2026-09-10', 'member', 200, null)], [])).toEqual([]);
        expect(findRecordsToReprice([], [r1, r2])).toEqual([]);
    });
});

describe('だれが何をできるか', () => {
    const admin = { id: 'a1', role: 'admin' };
    const manager = { id: 'm1', role: 'manager' };
    const foreman = { id: 'f1', role: 'foreman2' };
    const otherForeman = { id: 'f2', role: 'foreman1' };
    const worker = { id: 'w1', role: 'worker' };

    it('canInputForForeman: 管理者・マネージャーはどの班でも。職長は自分の班だけ。作業員は自分の ID を指定しても不可', () => {
        expect([canInputForForeman(admin, 'f1'), canInputForForeman(manager, 'f1'), canInputForForeman(foreman, 'f1'), canInputForForeman(otherForeman, 'f1'), canInputForForeman(worker, 'w1')])
            .toEqual([true, true, true, false, false]);
    });

    it('statusForNewRecord: 自分に付けたら確認待ち。ほかの人に付けたら確定', () => {
        expect([statusForNewRecord('f1', 'f1'), statusForNewRecord('f1', 'w1'), statusForNewRecord('a1', 'a1')]).toEqual(['pending', 'confirmed', 'pending']);
    });

    describe('canRemoveRecord', () => {
        it('自分の分: 自分で付けた確認待ちだけ、自分で取り下げられる（管理者でも同じ）', () => {
            expect(canRemoveRecord(foreman, record({ userId: 'f1', createdBy: 'f1', status: 'pending' }))).toBe(true);
            expect(canRemoveRecord(foreman, record({ userId: 'f1', createdBy: 'f1', status: 'confirmed' }))).toBe(false); // 認められた後
            expect(canRemoveRecord(foreman, record({ userId: 'f1', createdBy: 'a1', status: 'confirmed' }))).toBe(false); // 管理者が付けた自分の分
            expect(canRemoveRecord(foreman, record({ userId: 'f1', createdBy: 'a1', status: 'pending' }))).toBe(false);
            expect(canRemoveRecord(admin, record({ userId: 'a1', createdBy: 'a1', status: 'pending' }))).toBe(true);
            expect(canRemoveRecord(admin, record({ userId: 'a1', createdBy: 'f1', status: 'confirmed' }))).toBe(false);
        });

        it('ほかの人の分: 管理者・マネージャーはどれでも。職長は自分が付けた記録だけ。作業員は不可', () => {
            const byF1 = record({ userId: 'w1', createdBy: 'f1' });
            const byF2 = record({ userId: 'w1', createdBy: 'f2' });
            expect([canRemoveRecord(admin, byF1), canRemoveRecord(manager, byF2), canRemoveRecord(foreman, byF1), canRemoveRecord(foreman, byF2)])
                .toEqual([true, true, true, false]);
            expect(canRemoveRecord({ id: 'w9', role: 'worker' }, record({ userId: 'w1', createdBy: 'w9' }))).toBe(false);
        });
    });

    it('canConfirmRecord: 管理者・マネージャーだけ。確認待ちだけ。自分の分は認められない', () => {
        const pendingOfF1 = record({ userId: 'f1', createdBy: 'f1', status: 'pending' });
        expect([canConfirmRecord(admin, pendingOfF1), canConfirmRecord(manager, pendingOfF1), canConfirmRecord(foreman, pendingOfF1), canConfirmRecord(otherForeman, pendingOfF1)])
            .toEqual([true, true, false, false]);
        expect(canConfirmRecord(admin, record({ userId: 'f1', status: 'confirmed' }))).toBe(false);
        expect(canConfirmRecord(admin, record({ userId: 'a1', createdBy: 'a1', status: 'pending' }))).toBe(false);
        expect(canConfirmRecord(manager, record({ userId: 'm1', createdBy: 'm1', status: 'pending' }))).toBe(false);
    });
});

describe('decideAllowanceToggle（「出勤簿入力」で手当のボタンを1つ押したとき）', () => {
    const foreman = { id: 'f1', role: 'foreman2' };
    const INACTIVE = { id: 'large', isActive: false };
    /** 職長 f1 が、班のメンバー（その日の手配では職長以外）に、使用中の手当を付ける */
    const base = (over: Partial<AllowanceToggleInput> = {}): AllowanceToggleInput => ({
        operator: foreman, on: true, item: { id: 'large', isActive: true }, targetPayRole: 'member', monthClosed: false, existing: null, ...over,
    });

    // 確定か確認待ちかは、ここでは決めない（記録を入れるときに statusForNewRecord() で決める＝決める場所を1つにする）
    it('付ける: 区分は、その日の手配で決まった区分（targetPayRole）のまま。答えは「付ける」と区分だけ', () => {
        expect(decideAllowanceToggle(base({ targetPayRole: 'member' }))).toEqual({ action: 'add', payRole: 'member' });
        expect(decideAllowanceToggle(base({ targetPayRole: 'foreman' }))).toEqual({ action: 'add', payRole: 'foreman' });
    });

    it('付ける: だれが押しても区分は変わらない（職長・ほかの職長・管理者・マネージャー）', () => {
        for (const operator of [foreman, { id: 'f2', role: 'foreman1' }, { id: 'a1', role: 'admin' }, { id: 'm1', role: 'manager' }]) {
            expect([operator.id, decideAllowanceToggle(base({ operator, targetPayRole: 'foreman' }))]).toEqual([operator.id, { action: 'add', payRole: 'foreman' }]);
            expect([operator.id, decideAllowanceToggle(base({ operator, targetPayRole: 'member' }))]).toEqual([operator.id, { action: 'add', payRole: 'member' }]);
        }
    });

    it('手当が見つからなければ not_found（付けるのも取り消すのも。ほかのどの条件よりも先に見る）', () => {
        expect(decideAllowanceToggle(base({ item: null }))).toEqual({ action: 'none', reason: 'not_found' });
        expect(decideAllowanceToggle(base({ item: null, on: false, existing: record() }))).toEqual({ action: 'none', reason: 'not_found' });
        // すでに付いている・締めてある・対象の現場の手配に入っていない、が重なっていても not_found
        expect(decideAllowanceToggle(base({ item: null, existing: record(), monthClosed: true, targetPayRole: null }))).toEqual({ action: 'none', reason: 'not_found' });
        expect(decideAllowanceToggle(base({ item: null, on: false, monthClosed: true }))).toEqual({ action: 'none', reason: 'not_found' });
    });

    it('付ける: すでに付いていれば unchanged（締めてあっても・「使わない」の手当でも・対象の現場の手配に入っていなくても）', () => {
        expect(decideAllowanceToggle(base({ existing: record() }))).toEqual({ action: 'none', reason: 'unchanged' });
        expect(decideAllowanceToggle(base({ existing: record(), monthClosed: true }))).toEqual({ action: 'none', reason: 'unchanged' });
        expect(decideAllowanceToggle(base({ existing: record(), item: INACTIVE }))).toEqual({ action: 'none', reason: 'unchanged' });
        expect(decideAllowanceToggle(base({ existing: record(), targetPayRole: null }))).toEqual({ action: 'none', reason: 'unchanged' });
        expect(decideAllowanceToggle(base({ existing: record(), monthClosed: true, item: INACTIVE, targetPayRole: null }))).toEqual({ action: 'none', reason: 'unchanged' });
    });

    it('付ける: 締めた月には付けられない closed（「使わない」の手当・対象の現場の手配に入っていない、より先に見る）', () => {
        expect(decideAllowanceToggle(base({ monthClosed: true }))).toEqual({ action: 'none', reason: 'closed' });
        expect(decideAllowanceToggle(base({ monthClosed: true, item: INACTIVE }))).toEqual({ action: 'none', reason: 'closed' });
        expect(decideAllowanceToggle(base({ monthClosed: true, targetPayRole: null }))).toEqual({ action: 'none', reason: 'closed' });
        expect(decideAllowanceToggle(base({ monthClosed: true, item: INACTIVE, targetPayRole: null }))).toEqual({ action: 'none', reason: 'closed' });
    });

    it('付ける: 「使わない」の手当は inactive（対象の現場の手配に入っていない、より先に見る）', () => {
        expect(decideAllowanceToggle(base({ item: INACTIVE }))).toEqual({ action: 'none', reason: 'inactive' });
        expect(decideAllowanceToggle(base({ item: INACTIVE, targetPayRole: 'foreman' }))).toEqual({ action: 'none', reason: 'inactive' });
        expect(decideAllowanceToggle(base({ item: INACTIVE, targetPayRole: null }))).toEqual({ action: 'none', reason: 'inactive' });
    });

    it('付ける: その人が、その日、その班の対象の現場の手配に入っていなければ not_target（管理者が押しても）', () => {
        expect(decideAllowanceToggle(base({ targetPayRole: null }))).toEqual({ action: 'none', reason: 'not_target' });
        expect(decideAllowanceToggle(base({ operator: { id: 'a1', role: 'admin' }, targetPayRole: null }))).toEqual({ action: 'none', reason: 'not_target' });
    });

    it('取り消す: 自分が付けた、ほかの人の記録は取り消せる（「使わない」の手当でも・対象の現場の手配に入っていなくても）', () => {
        const existing = record({ createdBy: 'f1' });
        expect(decideAllowanceToggle(base({ on: false, existing }))).toEqual({ action: 'remove', record: existing });
        expect(decideAllowanceToggle(base({ on: false, existing, targetPayRole: null }))).toEqual({ action: 'remove', record: existing });
        expect(decideAllowanceToggle(base({ on: false, existing, item: INACTIVE, targetPayRole: null }))).toEqual({ action: 'remove', record: existing });
    });

    it('取り消す: もう無ければ unchanged（締めてあっても）', () => {
        expect(decideAllowanceToggle(base({ on: false }))).toEqual({ action: 'none', reason: 'unchanged' });
        expect(decideAllowanceToggle(base({ on: false, monthClosed: true }))).toEqual({ action: 'none', reason: 'unchanged' });
        expect(decideAllowanceToggle(base({ on: false, item: INACTIVE, targetPayRole: null }))).toEqual({ action: 'none', reason: 'unchanged' });
    });

    it('取り消す: 締めた月の記録は取り消せない closed（権限があっても。権限が無い場合より先に見る）', () => {
        expect(decideAllowanceToggle(base({ on: false, existing: record({ createdBy: 'f1' }), monthClosed: true }))).toEqual({ action: 'none', reason: 'closed' });
        expect(decideAllowanceToggle(base({ on: false, existing: record({ createdBy: 'f2' }), monthClosed: true }))).toEqual({ action: 'none', reason: 'closed' });
        expect(decideAllowanceToggle(base({ operator: { id: 'a1', role: 'admin' }, on: false, existing: record(), monthClosed: true }))).toEqual({ action: 'none', reason: 'closed' });
    });

    it('取り消す: ほかの職長が付けた記録・確定した自分の分は blocked', () => {
        expect(decideAllowanceToggle(base({ on: false, existing: record({ createdBy: 'f2' }) }))).toEqual({ action: 'none', reason: 'blocked' });
        expect(decideAllowanceToggle(base({ on: false, existing: record({ userId: 'f1', createdBy: 'f1', status: 'confirmed' }) })))
            .toEqual({ action: 'none', reason: 'blocked' });
    });

    it('取り消す: 自分の確認待ちは取り下げられる。管理者・マネージャーは、ほかの人の記録をどれでも取り消せる', () => {
        const own = record({ userId: 'f1', createdBy: 'f1', status: 'pending' });
        expect(decideAllowanceToggle(base({ on: false, existing: own }))).toEqual({ action: 'remove', record: own });
        const byOther = record({ createdBy: 'f2' });
        expect(decideAllowanceToggle(base({ operator: { id: 'a1', role: 'admin' }, on: false, existing: byOther }))).toEqual({ action: 'remove', record: byOther });
        expect(decideAllowanceToggle(base({ operator: { id: 'm1', role: 'manager' }, on: false, existing: byOther }))).toEqual({ action: 'remove', record: byOther });
    });
});

describe('checkCanCloseMonth（月を締めてよいか）', () => {
    it('終わった月で、確認待ちが無ければ締められる', () => {
        expect(checkCanCloseMonth('2026-09', 0, '2026-10-04')).toEqual({ ok: true });
    });
    it('形が違う → invalid_month ／ まだ終わっていない月 → not_ended ／ 確認待ちがある → has_pending（この順に見る）', () => {
        expect(checkCanCloseMonth('2026-9', 3, '2026-10-04')).toEqual({ ok: false, reason: 'invalid_month' });
        expect(checkCanCloseMonth(null, 0, '2026-10-04')).toEqual({ ok: false, reason: 'invalid_month' });
        expect(checkCanCloseMonth('2026-10', 3, '2026-10-04')).toEqual({ ok: false, reason: 'not_ended' });
        expect(checkCanCloseMonth('2026-10', 0, '2026-10-31')).toEqual({ ok: false, reason: 'not_ended' });
        expect(checkCanCloseMonth('2026-11', 0, '2026-10-04')).toEqual({ ok: false, reason: 'not_ended' });
        expect(checkCanCloseMonth('2026-09', 1, '2026-10-04')).toEqual({ ok: false, reason: 'has_pending' });
    });
    it('月が変わった日（日本時間）から、前の月を締められる', () => {
        expect(checkCanCloseMonth('2026-09', 0, todayJstDateKey(new Date('2026-09-30T14:59:59.000Z')))).toEqual({ ok: false, reason: 'not_ended' });
        expect(checkCanCloseMonth('2026-09', 0, todayJstDateKey(new Date('2026-09-30T15:00:00.000Z')))).toEqual({ ok: true });
    });
});

describe('summarizeAllowanceRecords（人ごとの集計）', () => {
    it('職長・職長以外に分けて、件数と金額を足す。確認待ちは合計に入れない', () => {
        const result = summarizeAllowanceRecords([
            { userId: 'f1', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'confirmed' },
            { userId: 'f1', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'confirmed' },
            { userId: 'f1', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
            { userId: 'f1', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'pending' },
            { userId: 'w1', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
        ]);
        expect(result.get('f1')).toEqual({
            userId: 'f1', foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200,
            byItem: { large: { foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200 } },
            totalDays: 3, totalAmount: 3200, pendingCount: 1, pendingAmount: 1500,
        });
        expect(result.get('w1')).toEqual({
            userId: 'w1', foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 200,
            byItem: { large: { foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 200 } },
            totalDays: 1, totalAmount: 200, pendingCount: 0, pendingAmount: 0,
        });
        expect(Array.from(result.keys())).toEqual(['f1', 'w1']);
    });

    it('金額は、記録に入っている金額をそのまま足す（月の途中で金額が変わった月は、日ごとの金額の足し算）', () => {
        const result = summarizeAllowanceRecords([
            { userId: 'w1', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
            { userId: 'w1', itemId: 'large', payRole: 'member', amount: 300, status: 'confirmed' },
        ]);
        expect([result.get('w1')?.memberDays, result.get('w1')?.memberAmount, result.get('w1')?.totalAmount]).toEqual([2, 500, 500]);
    });

    it('確認待ちだけの人は、合計 0・byItem は空', () => {
        const result = summarizeAllowanceRecords([{ userId: 'f1', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'pending' }]);
        expect(result.get('f1')).toEqual({
            userId: 'f1', foremanDays: 0, foremanAmount: 0, memberDays: 0, memberAmount: 0, byItem: {},
            totalDays: 0, totalAmount: 0, pendingCount: 1, pendingAmount: 1500,
        });
    });

    it('手当が2つあれば、手当ごとの内訳に分かれる（合計は全部の足し算）', () => {
        const result = summarizeAllowanceRecords([
            { userId: 'w1', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
            { userId: 'w1', itemId: 'other', payRole: 'foreman', amount: 500, status: 'confirmed' },
        ]);
        expect(result.get('w1')?.byItem).toEqual({
            large: { foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 200 },
            other: { foremanDays: 1, foremanAmount: 500, memberDays: 0, memberAmount: 0 },
        });
        expect([result.get('w1')?.totalDays, result.get('w1')?.totalAmount]).toEqual([2, 700]);
    });

    it('記録が無ければ空', () => {
        expect(summarizeAllowanceRecords([]).size).toBe(0);
    });
});

describe('buildAllowanceLines（「◯日 × 単価 ＝ ◯円」の行）', () => {
    const rec = (payRole: 'foreman' | 'member', amount: number, status: 'confirmed' | 'pending' = 'confirmed', itemId = 'large', itemName = '大規模手当') =>
        ({ itemId, itemName, payRole, amount, status });

    it('職長／職長以外・1日の金額ごとにまとめる。職長が先。確認待ちは入れない', () => {
        expect(buildAllowanceLines([rec('member', 200), rec('foreman', 1500), rec('member', 200), rec('foreman', 1500, 'pending'), rec('member', 200)])).toEqual([
            { itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500, days: 1, total: 1500 },
            { itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, days: 3, total: 600 },
        ]);
    });

    it('月の途中で金額が変わった月は、金額ごとに行が分かれる（金額の大きい順）', () => {
        expect(buildAllowanceLines([rec('member', 200), rec('member', 300), rec('member', 300)])).toEqual([
            { itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 300, days: 2, total: 600 },
            { itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, days: 1, total: 200 },
        ]);
    });

    it('手当が2つあれば、記録に最初に出てきた手当の順に並ぶ', () => {
        const lines = buildAllowanceLines([rec('member', 500, 'confirmed', 'other', '別の手当'), rec('foreman', 1500), rec('foreman', 800, 'confirmed', 'other', '別の手当')]);
        expect(lines.map((l) => `${l.itemName}/${l.payRole}/${l.amount}/${l.days}`)).toEqual(['別の手当/foreman/800/1', '別の手当/member/500/1', '大規模手当/foreman/1500/1']);
    });

    it('確認待ちだけ・記録なしは空', () => {
        expect(buildAllowanceLines([rec('foreman', 1500, 'pending')])).toEqual([]);
        expect(buildAllowanceLines([])).toEqual([]);
    });
});

describe('buildTargetRoles（手配から「対象の現場の手配に入っている人と日」と、その区分を決める）', () => {
    /** Map の中身を「日付/人:区分」の文字にして並べる（Map の中の並びは問わない） */
    const flat = (roles: Map<string, ExpectedEntry>) => Array.from(roles.values()).map((e) => `${e.date}/${e.userId}:${e.payRole}`).sort();

    it('対象の現場の手配の職長は職長、手配確定のメンバーは職長以外。鍵は entryKey(人, 日付)', () => {
        const roles = buildTargetRoles(TARGET, [asg('f1', '2026-09-01', ['w1', 'w2'])]);
        expect(roles.size).toBe(3);
        expect(roles.get(entryKey('f1', '2026-09-01'))).toEqual({ userId: 'f1', date: '2026-09-01', payRole: 'foreman' });
        expect(roles.get(entryKey('w1', '2026-09-01'))).toEqual({ userId: 'w1', date: '2026-09-01', payRole: 'member' });
        expect(roles.get(entryKey('w2', '2026-09-01'))).toEqual({ userId: 'w2', date: '2026-09-01', payRole: 'member' });
        for (const [key, entry] of roles) expect(key).toBe(entryKey(entry.userId, entry.date));
    });

    it('工事内容が対象でない手配（別の工事内容・未設定・寄せる前の値）は見ない', () => {
        expect(flat(buildTargetRoles(TARGET, [
            asg('f1', '2026-09-01', ['w1'], '改修'),
            asg('f1', '2026-09-02', ['w1'], null),
            // 旧い値を寄せる（normalizeConstructionContent）のは呼ぶ側。ここは、渡された名前をそのまま比べる
            asg('f1', '2026-09-03', ['w1'], 'large_scale'),
            asg('f1', '2026-09-04', ['w1'], ''),
        ]))).toEqual([]);
        // 手当の対象が別の工事内容なら、その工事内容の手配だけを見る
        expect(flat(buildTargetRoles('改修', [asg('f1', '2026-09-01', ['w1'], '改修'), asg('f2', '2026-09-01', ['w2'])])))
            .toEqual(['2026-09-01/f1:foreman', '2026-09-01/w1:member']);
    });

    it('手配確定のメンバーの中に職長本人が入っていても職長（1人・1日で1件）', () => {
        expect(flat(buildTargetRoles(TARGET, [asg('f1', '2026-09-01', ['w1', 'f1'])]))).toEqual(['2026-09-01/f1:foreman', '2026-09-01/w1:member']);
    });

    it('同じ日に2つの班: 自分の班（対象の現場）の職長が、ほかの班のメンバーにも入っていれば職長（手配の並びによらない）', () => {
        const assignments = [asg('f1', '2026-09-01', ['f2', 'w1']), asg('f2', '2026-09-01', ['w2'])];
        const want = ['2026-09-01/f1:foreman', '2026-09-01/f2:foreman', '2026-09-01/w1:member', '2026-09-01/w2:member'];
        expect(flat(buildTargetRoles(TARGET, assignments))).toEqual(want);
        expect(flat(buildTargetRoles(TARGET, [...assignments].reverse()))).toEqual(want);
    });

    it('ほかの班に入った人の自分の班が、対象でない現場なら、職長以外のまま（役職が職長でも）', () => {
        expect(flat(buildTargetRoles(TARGET, [asg('f1', '2026-09-01', ['f2']), asg('f2', '2026-09-01', ['w2'], '改修')])))
            .toEqual(['2026-09-01/f1:foreman', '2026-09-01/f2:member']);
    });

    it('日付が違えば別の件（同じ人が、ある日は職長以外・別の日は職長）', () => {
        expect(flat(buildTargetRoles(TARGET, [asg('f1', '2026-09-01', ['f2']), asg('f2', '2026-09-02', ['f1'])])))
            .toEqual(['2026-09-01/f1:foreman', '2026-09-01/f2:member', '2026-09-02/f1:member', '2026-09-02/f2:foreman']);
    });

    it('同じ人が、同じ日に2つの班のメンバーに入っていても1件（職長以外）。同じ手配が2回あっても同じ', () => {
        expect(flat(buildTargetRoles(TARGET, [asg('f1', '2026-09-01', ['w1']), asg('f2', '2026-09-01', ['w1', 'w1']), asg('f1', '2026-09-01', ['w1'])])))
            .toEqual(['2026-09-01/f1:foreman', '2026-09-01/f2:foreman', '2026-09-01/w1:member']);
    });

    it('空の ID は捨てる（職長の ID が空の手配・メンバーの中の空の ID）', () => {
        expect(flat(buildTargetRoles(TARGET, [asg('', '2026-09-01', ['w1', '']), asg('f1', '2026-09-02', ['', 'w2'])])))
            .toEqual(['2026-09-01/w1:member', '2026-09-02/f1:foreman', '2026-09-02/w2:member']);
    });

    it('手配が無ければ空。渡した手配は書き換えない', () => {
        expect(buildTargetRoles(TARGET, []).size).toBe(0);
        const assignments = [asg('f1', '2026-09-01', ['f2', 'w1']), asg('f2', '2026-09-01', ['w1'])];
        const before = JSON.stringify(assignments);
        buildTargetRoles(TARGET, assignments);
        expect(JSON.stringify(assignments)).toBe(before);
    });
});

describe('dayOffersForCrew（「出勤簿入力」で、その職長の班の画面で付けられる人と、その区分）', () => {
    const DAY = '2026-09-01';
    /** その日の手配の1件 */
    const day = (foremanId: string, workerIds: string[], content: string | null = TARGET) => asg(foremanId, DAY, workerIds, content);
    /** 職長 foremanId の班の画面で付けられる人 → 区分 */
    const offers = (dayAssignments: CrosscheckAssignment[], foremanId: string, target = TARGET) =>
        Object.fromEntries(dayOffersForCrew(target, dayAssignments, foremanId));

    it('その職長の、対象の現場の手配に入っている人だけ（職長本人は職長、手配確定のメンバーは職長以外）', () => {
        expect(offers([day('f1', ['w1', 'w2'])], 'f1')).toEqual({ f1: 'foreman', w1: 'member', w2: 'member' });
    });

    it('同じ日に、その職長が対象でない現場も持っていて、そちらにだけ入っている人は出ない', () => {
        const assignments = [day('f1', ['w1']), day('f1', ['w2', 'w1'], '改修'), day('f1', ['w3'], null)];
        expect(offers(assignments, 'f1')).toEqual({ f1: 'foreman', w1: 'member' });
        expect(offers([...assignments].reverse(), 'f1')).toEqual({ f1: 'foreman', w1: 'member' });
    });

    it('その職長の対象でない現場にだけ入っている人は、同じ日に、ほかの班の対象の現場に入っていても、この班の画面には出ない', () => {
        // w2 は、f1 の班では対象でない現場（改修）に、f2 の班では対象の現場に入っている
        const assignments = [day('f1', ['w1']), day('f1', ['w2'], '改修'), day('f2', ['w2'])];
        expect(offers(assignments, 'f1')).toEqual({ f1: 'foreman', w1: 'member' });
        expect(offers(assignments, 'f2')).toEqual({ f2: 'foreman', w2: 'member' });
        // f1 の手配が対象でない現場だけなら、f1 の班の画面では、だれにも付けられない（w2 に付けられるのは f2 の班の画面だけ）
        expect(offers([day('f1', ['w2'], '改修'), day('f2', ['w2'])], 'f1')).toEqual({});
    });

    it('その職長に、対象の現場の手配が無ければ空（対象でない現場だけ・手配が無い・ほかの職長の対象の現場に班員として入っているだけ）', () => {
        expect(offers([day('f1', ['w1'], '改修')], 'f1')).toEqual({});
        expect(offers([], 'f1')).toEqual({});
        // f1 は f2 の班（対象の現場）に入っているが、f1 が職長の対象の手配は無い＝ f1 の班の画面では、だれにも付けられない
        expect(offers([day('f2', ['f1', 'w1'])], 'f1')).toEqual({});
        expect(offers([day('f2', ['f1', 'w1']), day('f1', ['w5'], '改修')], 'f1')).toEqual({});
    });

    it('ほかの職長の手配のメンバーは出ない', () => {
        const assignments = [day('f1', ['w1']), day('f2', ['w2', 'w3'])];
        expect(offers(assignments, 'f1')).toEqual({ f1: 'foreman', w1: 'member' });
        expect(offers(assignments, 'f2')).toEqual({ f2: 'foreman', w2: 'member', w3: 'member' });
    });

    it('班に入っている人が、同じ日に自分の班（対象の現場）の職長でもあれば、この班の画面でも職長（手配の並びによらない）', () => {
        const assignments = [day('f1', ['f2', 'w1']), day('f2', ['w2'])];
        for (const list of [assignments, [...assignments].reverse()]) {
            expect(offers(list, 'f1')).toEqual({ f1: 'foreman', f2: 'foreman', w1: 'member' });
            expect(offers(list, 'f2')).toEqual({ f2: 'foreman', w2: 'member' });
        }
    });

    it('班に入っている人の自分の班が、対象でない現場なら職長以外（その人の班の画面では、だれにも付けられない）', () => {
        const assignments = [day('f1', ['f2']), day('f2', ['w2'], '改修')];
        expect(offers(assignments, 'f1')).toEqual({ f1: 'foreman', f2: 'member' });
        expect(offers(assignments, 'f2')).toEqual({});
    });

    it('その職長本人が、ほかの班のメンバーにも入っていても、自分の班の画面では職長。相手の班の画面でも職長', () => {
        const assignments = [day('f1', ['w1']), day('f2', ['f1', 'w2'])];
        expect(offers(assignments, 'f1')).toEqual({ f1: 'foreman', w1: 'member' });
        expect(offers(assignments, 'f2')).toEqual({ f2: 'foreman', f1: 'foreman', w2: 'member' });
    });

    it('同じ職長が、同じ日に対象の現場を2つ持っていれば、両方のメンバーが出る', () => {
        expect(offers([day('f1', ['w1']), day('f1', ['w2'])], 'f1')).toEqual({ f1: 'foreman', w1: 'member', w2: 'member' });
    });

    it('空の ID は出さない。メンバーの中に職長本人が入っていても1人', () => {
        expect(offers([day('f1', ['', 'w1', 'f1'])], 'f1')).toEqual({ f1: 'foreman', w1: 'member' });
    });

    it('手当の対象が別の工事内容なら、その工事内容の現場の手配で決まる', () => {
        const assignments = [day('f1', ['w1'], '改修'), day('f1', ['w2'])];
        expect(offers(assignments, 'f1', '改修')).toEqual({ f1: 'foreman', w1: 'member' });
        expect(offers(assignments, 'f1')).toEqual({ f1: 'foreman', w2: 'member' });
    });
});

describe('「出勤簿入力」のボタンと「手配と見比べる」で、決まりが食い違わない', () => {
    const D1 = '2026-09-01';
    const D2 = '2026-09-02';
    /** 手配の組と、そこから出るはずの「日付/人:区分」（上から、日付 → 人の ID 順） */
    const scenarios: [string, CrosscheckAssignment[], string[]][] = [
        ['1つの班', [asg('f1', D1, ['w1', 'w2'])],
            [`${D1}/f1:foreman`, `${D1}/w1:member`, `${D1}/w2:member`]],
        ['同じ日に2つの班（片方の職長が、もう片方の班にも入っている）', [asg('f1', D1, ['f2', 'w1']), asg('f2', D1, ['w2'])],
            [`${D1}/f1:foreman`, `${D1}/f2:foreman`, `${D1}/w1:member`, `${D1}/w2:member`]],
        ['ほかの班に入った職長の自分の班が、対象でない現場', [asg('f1', D1, ['f2', 'w1']), asg('f2', D1, ['w3'], '改修')],
            [`${D1}/f1:foreman`, `${D1}/f2:member`, `${D1}/w1:member`]],
        ['同じ職長が、同じ日に対象の現場と対象でない現場を持つ', [asg('f1', D1, ['w1']), asg('f1', D1, ['w2'], '改修')],
            [`${D1}/f1:foreman`, `${D1}/w1:member`]],
        ['メンバーの中に職長本人・空の ID', [asg('f1', D1, ['f1', '', 'w1'])],
            [`${D1}/f1:foreman`, `${D1}/w1:member`]],
        ['2人の職長が、たがいに相手の班にも入っている', [asg('f1', D1, ['f2']), asg('f2', D1, ['f1'])],
            [`${D1}/f1:foreman`, `${D1}/f2:foreman`]],
        ['日によって職長が入れかわる', [asg('f1', D1, ['f2', 'w1']), asg('f2', D2, ['f1', 'w1'])],
            [`${D1}/f1:foreman`, `${D1}/f2:member`, `${D1}/w1:member`, `${D2}/f1:member`, `${D2}/f2:foreman`, `${D2}/w1:member`]],
        ['同じ人が、同じ日に2つの班のメンバー', [asg('f1', D1, ['w1']), asg('f2', D1, ['w1'])],
            [`${D1}/f1:foreman`, `${D1}/f2:foreman`, `${D1}/w1:member`]],
        ['同じ職長が、同じ日に対象の現場を2つ持つ', [asg('f1', D1, ['w1']), asg('f1', D1, ['w2'])],
            [`${D1}/f1:foreman`, `${D1}/w1:member`, `${D1}/w2:member`]],
        ['対象の現場の手配が1つも無い', [asg('f1', D1, ['w1'], '改修'), asg('f2', D1, ['w2'], null)],
            []],
    ];

    it('同じ手配からは、ボタンの出る人と区分（dayOffersForCrew）と、付くはずの人と区分（buildExpectedEntries）が同じになる', () => {
        for (const [label, assignments, want] of scenarios) {
            // 「手配と見比べる」: 全員が出勤していて、全員が手当をもらえるロールのとき、付くはずの人と日
            const attendance = new Map<string, string>();
            for (const a of assignments) {
                for (const userId of [a.foremanId, ...a.workerIds]) attendance.set(entryKey(userId, a.dateKey), 'present');
            }
            const { expected, unworked, ineligible } = buildExpectedEntries({
                targetContent: TARGET, assignments, attendanceStatusByKey: attendance, isEligibleUser: () => true,
            });
            expect([label, unworked, ineligible]).toEqual([label, [], []]);
            const fromCrosscheck = expected.map((e) => `${e.date}/${e.userId}:${e.payRole}`);

            // 「出勤簿入力」: 日ごと・職長ごとの画面に出るボタンを、全部集める
            // （同じ人が、班の画面によって違う区分になっていたら、同じ人が2件になって、ここで食い違う）
            const fromButtons = new Set<string>();
            for (const date of new Set(assignments.map((a) => a.dateKey))) {
                const dayAssignments = assignments.filter((a) => a.dateKey === date);
                for (const foremanId of new Set(dayAssignments.map((a) => a.foremanId))) {
                    for (const [userId, payRole] of dayOffersForCrew(TARGET, dayAssignments, foremanId)) {
                        fromButtons.add(`${date}/${userId}:${payRole}`);
                    }
                }
            }

            expect([label, fromCrosscheck]).toEqual([label, want]);
            expect([label, Array.from(fromButtons).sort()]).toEqual([label, want]);
        }
    });

    it('ボタンで付けた記録（その画面で出た区分）は、「手配と見比べる」で、付けすぎ・区分ちがいにならない', () => {
        // f1 の班に f2 と w1。f2 は、同じ日に自分の班（対象の現場）の職長でもある
        const assignments = [asg('f1', D1, ['f2', 'w1']), asg('f2', D1, ['w2'])];
        // f1 の班の画面で、出ているボタンを全部押す
        const records = Array.from(dayOffersForCrew(TARGET, assignments, 'f1')).map(([userId, payRole], i) => ({ id: `rec${i}`, userId, date: D1, payRole }));
        expect(records.map((r) => `${r.userId}:${r.payRole}`).sort()).toEqual(['f1:foreman', 'f2:foreman', 'w1:member']);

        const attendance = new Map(['f1', 'f2', 'w1', 'w2'].map((userId) => [entryKey(userId, D1), 'present']));
        const { expected, unworked, ineligible } = buildExpectedEntries({ targetContent: TARGET, assignments, attendanceStatusByKey: attendance, isEligibleUser: () => true });
        const diff = diffExpectedAndRecords(expected, unworked, records, ineligible);
        expect([diff.extra, diff.mismatch]).toEqual([[], []]);
        // まだ押していないのは、f2 の班の w2 だけ
        expect(diff.missing).toEqual([{ userId: 'w2', date: D1, payRole: 'member' }]);
    });
});

describe('buildExpectedEntries（手配と出勤簿から「手当が付くはずの人と日」を作る）', () => {
    const worked = (...keys: [string, string][]) => new Map(keys.map(([u, d]) => [entryKey(u, d), 'present']));
    const everyone = () => true;

    it('職長は職長、手配確定のメンバーは職長以外。出勤簿が「出勤」の日だけ', () => {
        const { expected, unworked, ineligible } = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [asg('f1', '2026-09-01', ['w1', 'w2'])],
            attendanceStatusByKey: worked(['f1', '2026-09-01'], ['w1', '2026-09-01']),
            isEligibleUser: everyone,
        });
        expect(expected).toEqual([
            { userId: 'f1', date: '2026-09-01', payRole: 'foreman' },
            { userId: 'w1', date: '2026-09-01', payRole: 'member' },
        ]);
        expect(unworked).toEqual([{ userId: 'w2', date: '2026-09-01', payRole: 'member', attendanceStatus: null }]); // 出勤簿が無い
        expect(ineligible).toEqual([]);
    });

    it('工事内容が対象でない手配（別の工事内容・未設定）は見ない', () => {
        const { expected, unworked, ineligible } = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [asg('f1', '2026-09-01', ['w1'], '改修'), asg('f1', '2026-09-02', ['w1'], null)],
            attendanceStatusByKey: worked(['f1', '2026-09-01'], ['w1', '2026-09-01'], ['f1', '2026-09-02'], ['w1', '2026-09-02']),
            isEligibleUser: everyone,
        });
        expect([expected, unworked, ineligible]).toEqual([[], [], []]);
    });

    it('同じ日に、対象の現場と別の現場の両方に入っていても、1日として数える', () => {
        const { expected } = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [asg('f1', '2026-09-01', ['w1']), asg('f1', '2026-09-01', ['w1'], '改修'), asg('f1', '2026-09-01', ['w1'])],
            attendanceStatusByKey: worked(['f1', '2026-09-01'], ['w1', '2026-09-01']),
            isEligibleUser: everyone,
        });
        expect(expected.map((e) => `${e.userId}:${e.payRole}`)).toEqual(['f1:foreman', 'w1:member']);
    });

    it('役職が職長の人が、ほかの人の班に入った日は職長以外。同じ日に自分の班（対象の現場）も持っていれば職長（順番によらない）', () => {
        const attendance = worked(['f1', '2026-09-01'], ['f2', '2026-09-01'], ['f1', '2026-09-02'], ['f2', '2026-09-02']);
        const a = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [asg('f1', '2026-09-01', ['f2']), asg('f1', '2026-09-02', ['f2']), asg('f2', '2026-09-02', [])],
            attendanceStatusByKey: attendance, isEligibleUser: everyone,
        });
        expect(a.expected.map((e) => `${e.date}/${e.userId}:${e.payRole}`)).toEqual(['2026-09-01/f1:foreman', '2026-09-01/f2:member', '2026-09-02/f1:foreman', '2026-09-02/f2:foreman']);
        const b = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [asg('f2', '2026-09-02', []), asg('f1', '2026-09-02', ['f2']), asg('f1', '2026-09-01', ['f2'])],
            attendanceStatusByKey: attendance, isEligibleUser: everyone,
        });
        expect(b.expected).toEqual(a.expected);
    });

    it('自分の班の別の現場（対象でない）を持っていても、対象の現場に班員として入った日は職長以外', () => {
        const { expected } = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [asg('f1', '2026-09-01', ['f2']), asg('f2', '2026-09-01', [], '改修')],
            attendanceStatusByKey: worked(['f1', '2026-09-01'], ['f2', '2026-09-01']),
            isEligibleUser: everyone,
        });
        expect(expected.map((e) => `${e.userId}:${e.payRole}`)).toEqual(['f1:foreman', 'f2:member']);
    });

    it('手配確定のメンバーの中に職長本人が入っていても、職長（2件にならない）。空の ID は捨てる', () => {
        const { expected } = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [asg('f1', '2026-09-01', ['f1', '', 'w1'])],
            attendanceStatusByKey: worked(['f1', '2026-09-01'], ['w1', '2026-09-01']),
            isEligibleUser: everyone,
        });
        expect(expected).toEqual([
            { userId: 'f1', date: '2026-09-01', payRole: 'foreman' },
            { userId: 'w1', date: '2026-09-01', payRole: 'member' },
        ]);
    });

    it('手当をもらえるロールでない人（協力会社・User の行が無い人など）は ineligible（付くはずにも、出勤していないにも入れない。出勤簿があっても）', () => {
        const { expected, unworked, ineligible } = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [asg('partner1', '2026-09-01', ['w1', 'pm1']), asg('f1', '2026-09-02', ['pm1'])],
            attendanceStatusByKey: worked(['w1', '2026-09-01'], ['pm1', '2026-09-01']),
            isEligibleUser: (id) => id === 'w1' || id === 'f1',
        });
        expect(expected).toEqual([{ userId: 'w1', date: '2026-09-01', payRole: 'member' }]);
        expect(unworked).toEqual([{ userId: 'f1', date: '2026-09-02', payRole: 'foreman', attendanceStatus: null }]);
        // 区分は、手配のまま（協力会社が職長の手配なら職長）。出勤簿の区分は付かない
        expect(ineligible).toEqual([
            { userId: 'partner1', date: '2026-09-01', payRole: 'foreman' },
            { userId: 'pm1', date: '2026-09-01', payRole: 'member' },
            { userId: 'pm1', date: '2026-09-02', payRole: 'member' },
        ]);
    });

    it('付くはず・出勤していない・対象外の3つは重ならず、合わせると、対象の現場の手配に入っている人と日の全部（buildTargetRoles）になる', () => {
        const assignments = [
            asg('f1', '2026-09-01', ['w1', 'w2', 'pm1']),
            asg('f2', '2026-09-01', ['f1', 'w3']),
            asg('f1', '2026-09-02', ['w1'], '改修'),
            asg('f2', '2026-09-02', ['w1', 'pm1']),
        ];
        const { expected, unworked, ineligible } = buildExpectedEntries({
            targetContent: TARGET,
            assignments,
            attendanceStatusByKey: new Map([[entryKey('f1', '2026-09-01'), 'present'], [entryKey('w1', '2026-09-01'), 'absent'], [entryKey('w1', '2026-09-02'), 'night_shift']]),
            isEligibleUser: (id) => id !== 'pm1',
        });
        const keysOf = (entries: ExpectedEntry[]) => entries.map((e) => `${e.date}/${e.userId}:${e.payRole}`);
        expect(keysOf(expected)).toEqual(['2026-09-01/f1:foreman', '2026-09-02/w1:member']);
        expect(keysOf(unworked)).toEqual(['2026-09-01/f2:foreman', '2026-09-01/w1:member', '2026-09-01/w2:member', '2026-09-01/w3:member', '2026-09-02/f2:foreman']);
        expect(keysOf(ineligible)).toEqual(['2026-09-01/pm1:member', '2026-09-02/pm1:member']);
        const all = [...keysOf(expected), ...keysOf(unworked), ...keysOf(ineligible)].sort();
        expect(all).toEqual(Array.from(buildTargetRoles(TARGET, assignments).values()).map((e) => `${e.date}/${e.userId}:${e.payRole}`).sort());
        expect(new Set(all).size).toBe(all.length);
    });

    it('出勤簿の区分: 出勤・夜勤・休日出勤は「働いた」。休日・有給・欠勤・代休・出勤簿なしは unworked', () => {
        expect(ALLOWANCE_WORKED_STATUSES).toEqual(['present', 'night_shift', 'holiday_work']);
        expect(['present', 'night_shift', 'holiday_work', 'holiday', 'paid_leave', 'absent', 'compensatory_holiday', '', null, undefined].map((s) => isWorkedAttendanceStatus(s)))
            .toEqual([true, true, true, false, false, false, false, false, false, false]);

        const statuses = ['present', 'night_shift', 'holiday_work', 'holiday', 'paid_leave', 'absent', 'compensatory_holiday'];
        const dates = statuses.map((_, i) => `2026-09-0${i + 1}`);
        const { expected, unworked } = buildExpectedEntries({
            targetContent: TARGET,
            assignments: [...dates.map((d) => asg('f1', d, [])), asg('f1', '2026-09-08', [])],
            attendanceStatusByKey: new Map(statuses.map((s, i) => [entryKey('f1', dates[i]), s])),
            isEligibleUser: everyone,
        });
        expect(expected.map((e) => e.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
        expect(unworked.map((e) => `${e.date}:${e.attendanceStatus}`)).toEqual([
            '2026-09-04:holiday', '2026-09-05:paid_leave', '2026-09-06:absent', '2026-09-07:compensatory_holiday', '2026-09-08:null',
        ]);
    });

    it('並びは、3つとも、日付の古い順 → 人の ID 順（手配の並びによらない）', () => {
        const assignments = [asg('f2', '2026-09-02', ['w2', 'w1', 'p2', 'p1', 'x2', 'x1']), asg('f1', '2026-09-01', ['w2', 'w1', 'p2', 'p1', 'x2', 'x1'])];
        for (const list of [assignments, [...assignments].reverse()]) {
            const { expected, unworked, ineligible } = buildExpectedEntries({
                targetContent: TARGET,
                assignments: list,
                // f・w の人は出勤、x の人は出勤簿なし、p の人は手当の対象外
                attendanceStatusByKey: worked(['f1', '2026-09-01'], ['w1', '2026-09-01'], ['w2', '2026-09-01'], ['f2', '2026-09-02'], ['w1', '2026-09-02'], ['w2', '2026-09-02']),
                isEligibleUser: (id) => !id.startsWith('p'),
            });
            expect(expected.map((e) => `${e.date}/${e.userId}`)).toEqual(['2026-09-01/f1', '2026-09-01/w1', '2026-09-01/w2', '2026-09-02/f2', '2026-09-02/w1', '2026-09-02/w2']);
            expect(unworked.map((e) => `${e.date}/${e.userId}`)).toEqual(['2026-09-01/x1', '2026-09-01/x2', '2026-09-02/x1', '2026-09-02/x2']);
            expect(ineligible.map((e) => `${e.date}/${e.userId}`)).toEqual(['2026-09-01/p1', '2026-09-01/p2', '2026-09-02/p1', '2026-09-02/p2']);
        }
    });
});

describe('diffExpectedAndRecords（付くはずの人と日 と、実際の記録を見比べる）', () => {
    const expected = [
        { userId: 'f1', date: '2026-09-01', payRole: 'foreman' as const },
        { userId: 'w1', date: '2026-09-01', payRole: 'member' as const },
        { userId: 'w2', date: '2026-09-01', payRole: 'member' as const },
    ];
    const unworked = [{ userId: 'w3', date: '2026-09-01', payRole: 'member' as const, attendanceStatus: 'paid_leave' }];
    const ineligible = [{ userId: 'pm1', date: '2026-09-01', payRole: 'member' as const }];
    const rec = (id: string, userId: string, date: string, payRole: 'foreman' | 'member') => ({ id, userId, date, payRole });

    it('記録が1件も無ければ、付くはずの全部が「付いていない」（出勤していない人・対象外の人は「付いていない」に入れない）', () => {
        expect(diffExpectedAndRecords(expected, unworked, [])).toEqual({ missing: expected, extra: [], mismatch: [] });
        expect(diffExpectedAndRecords(expected, unworked, [], ineligible)).toEqual({ missing: expected, extra: [], mismatch: [] });
    });

    it('全部が合っていれば、どれも空', () => {
        const records = [rec('a', 'f1', '2026-09-01', 'foreman'), rec('b', 'w1', '2026-09-01', 'member'), rec('c', 'w2', '2026-09-01', 'member')];
        expect(diffExpectedAndRecords(expected, unworked, records, ineligible)).toEqual({ missing: [], extra: [], mismatch: [] });
    });

    it('付いていない・出勤していない・手当の対象外の人・手配に無い・区分が違う を分ける', () => {
        const records = [
            rec('a', 'f1', '2026-09-01', 'member'),   // 区分が違う（手配では職長）
            rec('b', 'w1', '2026-09-01', 'member'),   // 合っている
            rec('c', 'w3', '2026-09-01', 'member'),   // 手配には入っているが、出勤簿が有給
            rec('p', 'pm1', '2026-09-01', 'member'),  // 手配には入っているが、今は手当の対象外の人
            rec('d', 'w9', '2026-09-01', 'member'),   // 手配に入っていない
            rec('e', 'w1', '2026-09-02', 'foreman'),  // その日は手配が無い
            rec('q', 'pm1', '2026-09-02', 'member'),  // 対象外の人だが、その日は手配にも入っていない
        ];
        const diff = diffExpectedAndRecords(expected, unworked, records, ineligible);
        expect(diff.missing).toEqual([{ userId: 'w2', date: '2026-09-01', payRole: 'member' }]);
        expect(diff.extra.map((x) => `${x.record.id}:${x.reason}`)).toEqual(['c:not_worked', 'p:not_eligible', 'd:no_assignment', 'e:no_assignment', 'q:no_assignment']);
        expect(diff.mismatch.map((x) => `${x.record.id}:${x.expectedPayRole}`)).toEqual(['a:foreman']);
    });

    it('理由を決める順: 出勤していない（not_worked）→ 手当の対象外の人（not_eligible）→ 手配に無い（no_assignment）', () => {
        const who = { userId: 'x1', date: '2026-09-01', payRole: 'member' as const };
        const records = [rec('r', 'x1', '2026-09-01', 'member')];
        const reasonOf = (un: boolean, inel: boolean) =>
            diffExpectedAndRecords([], un ? [{ ...who, attendanceStatus: 'absent' }] : [], records, inel ? [who] : []).extra.map((x) => x.reason);
        // 同じ人・同じ日が、両方の一覧に入っていても not_worked
        expect([reasonOf(true, true), reasonOf(true, false), reasonOf(false, true), reasonOf(false, false)])
            .toEqual([['not_worked'], ['not_worked'], ['not_eligible'], ['no_assignment']]);
        // 付くはずの一覧に入っていれば、ほかの一覧にも入っていても、付けすぎにしない
        expect(diffExpectedAndRecords([who], [{ ...who, attendanceStatus: 'absent' }], records, [who])).toEqual({ missing: [], extra: [], mismatch: [] });
    });

    it('対象外の人の一覧（4つめ）を渡さなければ、対象外の人の記録は no_assignment', () => {
        const diff = diffExpectedAndRecords(expected, unworked, [rec('p', 'pm1', '2026-09-01', 'member')]);
        expect(diff.extra.map((x) => `${x.record.id}:${x.reason}`)).toEqual(['p:no_assignment']);
    });

    it('記録の、ほかの列（金額・状態など）は、そのまま返る', () => {
        const records = [{ id: 'x', userId: 'w9', date: '2026-09-01', payRole: 'member' as const, amount: 200, status: 'pending' }];
        expect(diffExpectedAndRecords([], [], records).extra[0].record).toBe(records[0]);
    });
});

// ================================================================ 記録の金額を手で直す（kei 決定 2026-10-05）

describe('記録の金額を手で直す（canEditRecordAmount・canRemoveRecord・decideAllowanceToggle・findRecordsToReprice）', () => {
    const ADMIN = { id: 'admin1', role: 'admin' };
    const ADMIN_UPPER = { id: 'admin2', role: 'ADMIN' };
    const MANAGER = { id: 'manager1', role: 'manager' };
    const FOREMAN = { id: 'f1', role: 'foreman1' };
    const WORKER = { id: 'w1', role: 'worker' };

    describe('canEditRecordAmount', () => {
        it('直せるのは管理者だけ（ロールの大文字も同じ）。マネージャー・職長・作業員・協力会社は直せない', () => {
            const r = record({ userId: 'w9', createdBy: 'f1' });
            expect(canEditRecordAmount(ADMIN, r)).toBe(true);
            expect(canEditRecordAmount(ADMIN_UPPER, r)).toBe(true);
            expect(canEditRecordAmount(MANAGER, r)).toBe(false);
            expect(canEditRecordAmount(FOREMAN, r)).toBe(false);
            expect(canEditRecordAmount({ id: 'f2', role: 'foreman2' }, r)).toBe(false);
            expect(canEditRecordAmount(WORKER, r)).toBe(false);
            expect(canEditRecordAmount({ id: 'p1', role: 'partner' }, r)).toBe(false);
            expect(canEditRecordAmount({ id: 'x', role: '' }, r)).toBe(false);
        });

        it('自分の分の金額は、自分では直せない（管理者でも。だれが付けた記録でも・確認待ちでも）', () => {
            expect(canEditRecordAmount(ADMIN, record({ userId: 'admin1', createdBy: 'f1' }))).toBe(false);
            expect(canEditRecordAmount(ADMIN, record({ userId: 'admin1', createdBy: 'admin1', status: 'pending' }))).toBe(false);
            // ほかの管理者なら直せる
            expect(canEditRecordAmount(ADMIN_UPPER, record({ userId: 'admin1', createdBy: 'admin1', status: 'pending' }))).toBe(true);
        });

        it('確定・確認待ちのどちらも直せる。もう手で直した記録も、また直せる', () => {
            expect(canEditRecordAmount(ADMIN, record({ status: 'confirmed' }))).toBe(true);
            expect(canEditRecordAmount(ADMIN, record({ status: 'pending' }))).toBe(true);
            expect(canEditRecordAmount(ADMIN, record({ amountEdited: true }))).toBe(true);
        });
    });

    describe('canRemoveRecord: 金額を手で直した記録', () => {
        it('職長は取り消せない（自分が付けた記録でも）。作業員も取り消せない', () => {
            expect(canRemoveRecord(FOREMAN, record({ userId: 'w9', createdBy: 'f1' }))).toBe(true);
            expect(canRemoveRecord(FOREMAN, record({ userId: 'w9', createdBy: 'f1', amountEdited: true }))).toBe(false);
            expect(canRemoveRecord({ id: 'f2', role: 'FOREMAN2' }, record({ userId: 'w9', createdBy: 'f2', amountEdited: true }))).toBe(false);
            // 自分で付けた自分の確認待ちでも、手で直してあれば職長は取り下げられない
            expect(canRemoveRecord(FOREMAN, record({ userId: 'f1', createdBy: 'f1', status: 'pending', amountEdited: true }))).toBe(false);
            expect(canRemoveRecord(WORKER, record({ userId: 'w1', createdBy: 'w1', status: 'pending', amountEdited: true }))).toBe(false);
        });

        it('管理者・マネージャーは、今までどおり取り消せる（自分の確定した分は、今までどおり取り消せない）', () => {
            expect(canRemoveRecord(ADMIN, record({ userId: 'w9', createdBy: 'f1', amountEdited: true }))).toBe(true);
            expect(canRemoveRecord(MANAGER, record({ userId: 'w9', createdBy: 'f1', amountEdited: true }))).toBe(true);
            expect(canRemoveRecord(MANAGER, record({ userId: 'manager1', createdBy: 'f1', amountEdited: true }))).toBe(false);
            expect(canRemoveRecord(MANAGER, record({ userId: 'manager1', createdBy: 'manager1', status: 'pending', amountEdited: true }))).toBe(true);
        });

        it('amountEdited を省いた・false の記録は、今までと同じ答え', () => {
            const ops = [ADMIN, MANAGER, FOREMAN, WORKER, { id: 'f2', role: 'foreman2' }];
            const ids = ['admin1', 'manager1', 'f1', 'f2', 'w1'];
            for (const op of ops) {
                for (const userId of ids) {
                    for (const createdBy of ids) {
                        for (const status of ['confirmed', 'pending'] as const) {
                            const base = record({ userId, createdBy, status });
                            expect(canRemoveRecord(op, { ...base, amountEdited: false })).toBe(canRemoveRecord(op, base));
                        }
                    }
                }
            }
        });
    });

    it("decideAllowanceToggle: 職長が、手で直した記録を取り消そうとすると 'blocked'（締めた月なら、先に 'closed'）", () => {
        const base: AllowanceToggleInput = {
            operator: FOREMAN, on: false, item: { id: 'large', isActive: true }, targetPayRole: null, monthClosed: false,
            existing: record({ userId: 'w9', createdBy: 'f1', amountEdited: true }),
        };
        expect(decideAllowanceToggle(base)).toEqual({ action: 'none', reason: 'blocked' });
        expect(decideAllowanceToggle({ ...base, monthClosed: true })).toEqual({ action: 'none', reason: 'closed' });
        expect(decideAllowanceToggle({ ...base, operator: MANAGER })).toEqual({ action: 'remove', record: base.existing });
    });

    it('findRecordsToReprice: 手で直した記録は、金額の表と違っていても対象にしない', () => {
        const rates = [rate({ id: 'r1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01' })];
        const records = [
            { id: 'a', date: '2026-09-10', payRole: 'member' as const, amount: 1000, rateId: 'r1', amountEdited: true },
            { id: 'b', date: '2026-09-10', payRole: 'member' as const, amount: 1000, rateId: 'r1', amountEdited: false },
            { id: 'c', date: '2026-09-10', payRole: 'foreman' as const, amount: 900, rateId: 'r0' },
            { id: 'd', date: '2026-09-11', payRole: 'foreman' as const, amount: 0, rateId: null, amountEdited: true },
        ];
        expect(findRecordsToReprice(records, rates).map((c) => [c.record.id, c.amount, c.rateId])).toEqual([
            ['b', 200, 'r1'],
            ['c', 1500, 'r1'],
        ]);
    });
});
