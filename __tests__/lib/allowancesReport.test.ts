/**
 * @jest-environment node
 *
 * lib/allowancesReport.ts（手当: 一覧・集計・本人の表示の部品。読むだけ）のテスト。
 *
 *   toAllowanceRecordResponse … 記録の一覧の1行の形（GET /records・POST /records が同じ形で返す）
 *   compareUsersStable        … 人の並び（並び順 → 名前 → 人の ID。同じ名前の人がいても、毎回同じ並び）
 *   loadAllowanceSummary      … 月の集計（全員の一覧と、CSV の集計が使う）
 *   loadMyAllowance           … 本人の、その月の手当
 *
 * いちばん守りたい約束:
 *   - 合計は「記録に写してある金額」の足し算。確認待ちは合計に入れない
 *   - 締めた月の記録には、「取り消す」「認める」を出さない（管理者でも）
 *   - 月の集計に出すのは、その月に記録のある人だけ。社員の分と、常用の一人親方の分に分けて、足すと全体の合計になる
 *     （User の行が消えた一人親方の記録も、一人親方の側に数える）
 *   - 本人の表示は本人の分だけ（ID が空なら、読まずに例外）。付けた人の名前・メモは出さない
 *
 * @/lib/prisma は jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * だから「絞り込みが正しいか」は、返ってきた値ではなく、findMany・findUnique に渡した引数で確かめる。
 * 日付は、過去の決まった月（2026年9月 など）を使う。この部品は時計を見ない。
 */
import { prisma } from '@/lib/prisma';
import { canConfirmRecord, canRemoveRecord, type AllowanceOperator, type AllowanceStatus } from '@/lib/allowances';
import * as evaluationPointsReport from '@/lib/evaluationPointsReport';
import {
    ALLOWANCE_RECORD_SELECT,
    NO_STORE,
    UNKNOWN_USER_NAME,
    compareUsersStable,
    loadAllowanceSummary,
    loadMyAllowance,
    loadUserNames,
    toAllowanceRecordResponse,
    type AllowanceRecordRowLike,
    type AllowanceTotals,
} from '@/lib/allowancesReport';

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

interface FindArgs { where?: unknown; orderBy?: unknown; select?: Record<string, unknown> }
/** その findMany・findUnique の、1回目の呼び出しに渡した引数 */
const firstArg = (fn: unknown): FindArgs => mock(fn).mock.calls[0][0] as FindArgs;
/** ID の並びは問わずに比べる（where の in は、並びが違っても同じ絞り込み） */
const sorted = (ids: readonly string[]) => [...ids].sort();

/**
 * 月として受け付けない値（'YYYY-MM' で、年は 2000〜2999・月は 01〜12 だけ）。
 * '0026-09' のような年は、Date が 1926年と読むので受け付けない
 */
const BAD_MONTHS: unknown[] = [
    '2026-13', '2026-00', '2026-9', '202609', '2026-09-01', '2026/09', '', ' 2026-09', '2026-09\n',
    '0026-09', '0000-01', '1999-12', '3000-01', '9999-12',
    null, undefined, 202609, {},
];

/** 手当の6つの表と、書き込みに使う関数（この部品は読むだけなので、どれも呼ばれないはず） */
const ALLOWANCE_MODELS = {
    allowanceItem: prisma.allowanceItem,
    allowanceRate: prisma.allowanceRate,
    allowanceRecord: prisma.allowanceRecord,
    allowanceMonthClose: prisma.allowanceMonthClose,
    allowanceLog: prisma.allowanceLog,
    allowanceSetting: prisma.allowanceSetting,
};
const WRITE_METHODS = ['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const;
/** 何も書いていないこと（書き込みの鍵も取っていないこと） */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    for (const [name, model] of Object.entries(ALLOWANCE_MODELS)) {
        for (const method of WRITE_METHODS) {
            expect([name, method, mock(model[method]).mock.calls.length]).toEqual([name, method, 0]);
        }
    }
};

beforeEach(() => {
    jest.clearAllMocks();
});

// ================================================================ 記録の一覧の1行

const ADMIN: AllowanceOperator = { id: 'admin1', role: 'admin' };
const MANAGER: AllowanceOperator = { id: 'manager1', role: 'manager' };
const FOREMAN_A: AllowanceOperator = { id: 'foremanA', role: 'foreman2' };
const FOREMAN_B: AllowanceOperator = { id: 'foremanB', role: 'foreman1' };
const WORKER: AllowanceOperator = { id: 'worker1', role: 'worker' };

/** 締めた月が1つも無い */
const NOT_CLOSED: ReadonlySet<string> = new Set<string>();
/** 9月だけ締めてある */
const SEPTEMBER_CLOSED: ReadonlySet<string> = new Set(['2026-09']);

/** DB から読んだ記録の1行（ALLOWANCE_RECORD_SELECT の列）。作業員1 の 9/30 の分を、職長A が付けた（確定） */
const recordRow = (over: Partial<AllowanceRecordRowLike> = {}): AllowanceRecordRowLike => ({
    id: 'r1', userId: 'worker1', date: utc0('2026-09-30'), itemId: 'large', itemName: '大規模手当',
    payRole: 'member', amount: 200, status: 'confirmed', source: 'attendance', note: null,
    createdBy: 'foremanA', createdByName: '職長A', createdAt: new Date('2026-09-30T09:00:00.000Z'),
    confirmedByName: null, confirmedAt: null, ...over,
});

describe('toAllowanceRecordResponse（記録の一覧の1行の形）', () => {
    it("日付は 'YYYY-MM-DD'、日時は ISO 文字列。ほかの列は、行の値のまま", () => {
        const row = recordRow({
            payRole: 'foreman', amount: 1500, source: 'manual', note: '応援で入った日',
            createdBy: 'admin1', createdByName: '管理者1', createdAt: new Date('2026-10-01T15:04:05.678Z'),
            confirmedByName: 'マネージャー1', confirmedAt: new Date('2026-10-02T00:30:00.000Z'),
        });
        expect(toAllowanceRecordResponse(row, '作業員1', MANAGER, NOT_CLOSED)).toEqual({
            id: 'r1', userId: 'worker1', userName: '作業員1', date: '2026-09-30',
            itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500,
            status: 'confirmed', source: 'manual', note: '応援で入った日',
            createdBy: 'admin1', createdByName: '管理者1', createdAt: '2026-10-01T15:04:05.678Z',
            confirmedByName: 'マネージャー1', confirmedAt: '2026-10-02T00:30:00.000Z',
            closed: false, canRemove: true, canConfirm: false,
        });
    });

    it('だれも認めていない記録（confirmedAt が null）は、confirmedAt・confirmedByName が null のまま', () => {
        const res = toAllowanceRecordResponse(recordRow({ userId: 'foremanA', status: 'pending' }), '職長A', ADMIN, NOT_CLOSED);
        expect([res.status, res.confirmedByName, res.confirmedAt, res.note]).toEqual(['pending', null, null, null]);
    });

    it('名前は、渡した名前をそのまま出す（User の行が無い人は、呼ぶ側が「（不明）」を渡す）', () => {
        expect(toAllowanceRecordResponse(recordRow({ userId: 'ghost' }), UNKNOWN_USER_NAME, ADMIN, NOT_CLOSED).userName).toBe('（不明）');
        expect(toAllowanceRecordResponse(recordRow(), '作業員1', ADMIN, NOT_CLOSED).userName).toBe('作業員1');
    });

    it('手当の名前・金額は、記録に写してある値のまま（0円の記録も 0 のまま）', () => {
        const old = toAllowanceRecordResponse(recordRow({ itemName: '大規模手当（旧名）', amount: 180 }), '作業員1', ADMIN, NOT_CLOSED);
        expect([old.itemId, old.itemName, old.amount]).toEqual(['large', '大規模手当（旧名）', 180]);
        expect(toAllowanceRecordResponse(recordRow({ amount: 0 }), '作業員1', ADMIN, NOT_CLOSED).amount).toBe(0);
    });

    it("payRole・status は決まった値にそろえる（DB の知らない文字 → payRole は 'member'、status は 'confirmed'）", () => {
        const of = (over: Partial<AllowanceRecordRowLike>) => toAllowanceRecordResponse(recordRow(over), '作業員1', ADMIN, NOT_CLOSED);
        expect(['foreman', 'member', 'FOREMAN', 'Foreman', '', 'x'].map((payRole) => of({ payRole }).payRole))
            .toEqual(['foreman', 'member', 'member', 'member', 'member', 'member']);
        expect(['pending', 'confirmed', 'PENDING', '', 'x'].map((status) => of({ status }).status))
            .toEqual(['pending', 'confirmed', 'confirmed', 'confirmed', 'confirmed']);
        // 知らない文字の status は「確定」として扱うので、管理者にも「認める」は出ない
        expect([of({ status: 'PENDING' }).canRemove, of({ status: 'PENDING' }).canConfirm]).toEqual([true, false]);
    });

    it('closed: 記録の日付の月が、締めた月に入っていれば true（月の境目: 9/30 は 9月、10/1 は 10月）', () => {
        const closedOf = (dateKey: string, months: string[]) =>
            toAllowanceRecordResponse(recordRow({ date: utc0(dateKey) }), '作業員1', ADMIN, new Set(months)).closed;
        const days = ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01'];
        expect(days.map((d) => closedOf(d, ['2026-09']))).toEqual([false, true, true, false]);
        expect(days.map((d) => closedOf(d, ['2026-10']))).toEqual([false, false, false, true]);
        expect(days.map((d) => closedOf(d, ['2026-08', '2026-10']))).toEqual([true, false, false, true]);
        expect(days.map((d) => closedOf(d, []))).toEqual([false, false, false, false]);
        // 年が違えば別の月。年をまたぐ境目（12/31 は 12月、1/1 は 翌年の1月）
        expect(closedOf('2025-09-30', ['2026-09'])).toBe(false);
        expect([closedOf('2026-12-31', ['2026-12']), closedOf('2027-01-01', ['2026-12']), closedOf('2027-01-01', ['2027-01'])]).toEqual([true, false, true]);
    });

    it('closed は「記録の日付」の月で決まる（付けた日時・認めた日時の月ではない）', () => {
        // 9/30 の分を、10/2 に付けて、10/3 に認めた
        const row = recordRow({
            date: utc0('2026-09-30'), createdAt: new Date('2026-10-02T01:00:00.000Z'),
            confirmedByName: '管理者1', confirmedAt: new Date('2026-10-03T01:00:00.000Z'),
        });
        expect(toAllowanceRecordResponse(row, '作業員1', ADMIN, new Set(['2026-10'])).closed).toBe(false);
        expect(toAllowanceRecordResponse(row, '作業員1', ADMIN, new Set(['2026-09'])).closed).toBe(true);
    });

    it('締めた月の記録は、取り消すのも認めるのも false（管理者・マネージャーでも。自分の確認待ちでも）', () => {
        const cases: [string, AllowanceOperator, Partial<AllowanceRecordRowLike>][] = [
            ['管理者が、ほかの人の確認待ちを見る', ADMIN, { userId: 'foremanA', createdBy: 'foremanA', status: 'pending' }],
            ['マネージャーが、ほかの人の確定した記録を見る', MANAGER, { userId: 'worker1', createdBy: 'foremanA', status: 'confirmed' }],
            ['職長が、自分で付けた自分の確認待ちを見る', FOREMAN_A, { userId: 'foremanA', createdBy: 'foremanA', status: 'pending' }],
            ['職長が、自分で付けたほかの人の記録を見る', FOREMAN_A, { userId: 'worker1', createdBy: 'foremanA', status: 'confirmed' }],
        ];
        for (const [label, operator, over] of cases) {
            // 同じ記録でも、締めていなければ「取り消す」は出る（＝ false になるのは、締めたから）
            const open = toAllowanceRecordResponse(recordRow(over), 'だれか', operator, NOT_CLOSED);
            expect([label, open.closed, open.canRemove]).toEqual([label, false, true]);
            const res = toAllowanceRecordResponse(recordRow(over), 'だれか', operator, SEPTEMBER_CLOSED);
            expect([label, res.closed, res.canRemove, res.canConfirm]).toEqual([label, true, false, false]);
        }
        // 締めていない月（10月）の記録は、9月を締めても変わらない
        const october = toAllowanceRecordResponse(recordRow({ date: utc0('2026-10-01'), userId: 'foremanA', status: 'pending' }), '職長A', ADMIN, SEPTEMBER_CLOSED);
        expect([october.closed, october.canRemove, october.canConfirm]).toEqual([false, true, true]);
    });

    it('締めていない月: 取り消せるか・認められるかは、lib/allowances.ts の決まりどおり', () => {
        const of = (operator: AllowanceOperator, over: Partial<AllowanceRecordRowLike>) => {
            const res = toAllowanceRecordResponse(recordRow(over), 'だれか', operator, NOT_CLOSED);
            return [res.canRemove, res.canConfirm];
        };
        // 管理者・マネージャーが、ほかの人の確認待ちを見る → 取り消せる・認められる
        expect(of(ADMIN, { userId: 'foremanA', createdBy: 'foremanA', status: 'pending' })).toEqual([true, true]);
        expect(of(MANAGER, { userId: 'foremanA', createdBy: 'foremanA', status: 'pending' })).toEqual([true, true]);
        // 確定した記録 → 「認める」は出ない（取り消すのは、管理者・マネージャーならできる）
        expect(of(ADMIN, { userId: 'worker1', createdBy: 'foremanA', status: 'confirmed' })).toEqual([true, false]);
        expect(of(MANAGER, { userId: 'worker1', createdBy: 'foremanA', status: 'confirmed' })).toEqual([true, false]);
        // 自分の確定した分 → どちらもできない（管理者でも）
        expect(of(FOREMAN_A, { userId: 'foremanA', createdBy: 'foremanA', status: 'confirmed' })).toEqual([false, false]);
        expect(of(ADMIN, { userId: 'admin1', createdBy: 'foremanA', status: 'confirmed' })).toEqual([false, false]);
        // 自分で付けた自分の確認待ち → 取り下げるだけできる（自分では認められない。管理者でも）
        expect(of(FOREMAN_A, { userId: 'foremanA', createdBy: 'foremanA', status: 'pending' })).toEqual([true, false]);
        expect(of(ADMIN, { userId: 'admin1', createdBy: 'admin1', status: 'pending' })).toEqual([true, false]);
        // 職長: 自分が付けた、ほかの人の記録は取り消せる。ほかの職長が付けた記録は取り消せない。認めるのは、どれもできない
        expect(of(FOREMAN_A, { userId: 'worker1', createdBy: 'foremanA', status: 'confirmed' })).toEqual([true, false]);
        expect(of(FOREMAN_B, { userId: 'worker1', createdBy: 'foremanA', status: 'confirmed' })).toEqual([false, false]);
        expect(of(FOREMAN_B, { userId: 'foremanA', createdBy: 'foremanA', status: 'pending' })).toEqual([false, false]);
        // 作業員は、どちらもできない
        expect(of(WORKER, { userId: 'foremanA', createdBy: 'worker1', status: 'pending' })).toEqual([false, false]);
    });

    it('締めていない月は canRemoveRecord・canConfirmRecord と同じ答え、締めた月はどちらも false（操作する人 × だれの分 × 付けた人 × 状態 の総当たり）', () => {
        const operators: AllowanceOperator[] = [ADMIN, MANAGER, FOREMAN_A, FOREMAN_B, WORKER, { id: 'admin1', role: 'ADMIN' }, { id: 'partner1', role: 'partner' }];
        const ids = ['admin1', 'manager1', 'foremanA', 'foremanB', 'worker1'];
        const statuses: AllowanceStatus[] = ['confirmed', 'pending'];
        for (const operator of operators) {
            for (const userId of ids) {
                for (const createdBy of ids) {
                    for (const status of statuses) {
                        const row = recordRow({ userId, createdBy, status });
                        const like = { id: row.id, userId, itemId: row.itemId, status, createdBy };
                        const label = `${operator.id}（${operator.role}）が、${userId} の分（付けた人 ${createdBy}・${status}）を見る`;
                        const open = toAllowanceRecordResponse(row, 'だれか', operator, NOT_CLOSED);
                        expect([label, open.canRemove, open.canConfirm]).toEqual([label, canRemoveRecord(operator, like), canConfirmRecord(operator, like)]);
                        const shut = toAllowanceRecordResponse(row, 'だれか', operator, SEPTEMBER_CLOSED);
                        expect([label, shut.canRemove, shut.canConfirm]).toEqual([label, false, false]);
                    }
                }
            }
        }
    });

    it('全部の列を持つ行（POST /records が渡す、入ったばかりの行）でも、返す項目は同じ（rateId・foremanId・confirmedBy・updatedAt は出さない）', () => {
        const full = { ...recordRow(), rateId: 'rate1', foremanId: 'foremanA', confirmedBy: null, updatedAt: new Date('2026-09-30T09:00:00.000Z') };
        const fromFull = toAllowanceRecordResponse(full, '作業員1', ADMIN, NOT_CLOSED);
        expect(fromFull).toEqual(toAllowanceRecordResponse(recordRow(), '作業員1', ADMIN, NOT_CLOSED));
        expect(Object.keys(fromFull).sort()).toEqual([
            'amount', 'canConfirm', 'canRemove', 'closed', 'confirmedAt', 'confirmedByName', 'createdAt', 'createdBy', 'createdByName',
            'date', 'id', 'itemId', 'itemName', 'note', 'payRole', 'source', 'status', 'userId', 'userName',
        ]);
    });

    it('ALLOWANCE_RECORD_SELECT は、1行の形に要る列を全部読む（列が欠けると、職長の記録が「職長以外」に見えてしまう）', () => {
        expect(Object.keys(ALLOWANCE_RECORD_SELECT).sort()).toEqual(Object.keys(recordRow()).sort());
        expect(Object.values(ALLOWANCE_RECORD_SELECT).every((v) => v === true)).toBe(true);
    });
});

// ================================================================ 人の並び

describe('compareUsersStable（人の並び: 並び順 → 名前 → 人の ID）', () => {
    const person = (userId: string, displayName: string, dispatchSortOrder: number | null) => ({ userId, displayName, dispatchSortOrder });
    const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);

    /** 並べたあとの正しい順（上から）。ID は、わざと並び順・名前の順と逆向きにしてある（ID が先に効いたら、順が変わる） */
    const ORDERED = [
        person('x9', 'わたなべ', 0),   // 並び順 0 がいちばん先（0 も「順番あり」。名前は最後でも、並び順が先に効く）
        person('x8', 'アオキ', 2),     // 並び順が同じ（2）人の中では、名前の日本語順
        person('k1', 'たなか', 2),     // 並び順も名前も同じ2人は、人の ID 順
        person('k2', 'たなか', 2),
        person('x0', 'わたなべ', 2),
        person('z1', 'アオキ', null),  // 並び順の無い人は最後。その中でも、名前の日本語順
        person('a1', 'いとう', null),
        person('m1', 'ふたご', null),  // 並び順が無くて名前も同じ2人は、人の ID 順
        person('m2', 'ふたご', null),
    ];

    it('dispatchSortOrder の小さい順 → null は最後 → 名前の日本語順 → 人の ID 順（どんな並びから始めても、同じ結果）', () => {
        const expected = ORDERED.map((p) => p.userId);
        // 逆順・1つずつずらした並び・ID の昇順／降順 から並べても、結果は同じ
        const starts = [
            [...ORDERED].reverse(),
            ...ORDERED.map((_, i) => [...ORDERED.slice(i), ...ORDERED.slice(0, i)]),
            [...ORDERED].sort((a, b) => (a.userId < b.userId ? -1 : 1)),
            [...ORDERED].sort((a, b) => (a.userId < b.userId ? 1 : -1)),
        ];
        for (const start of starts) {
            expect([...start].sort(compareUsersStable).map((p) => p.userId)).toEqual(expected);
        }
    });

    it('同じ人どうしは 0。違う人どうしは 0 にならず、向きを入れ替えると符号が逆になる', () => {
        for (const a of ORDERED) {
            expect([a.userId, sign(compareUsersStable(a, { ...a }))]).toEqual([a.userId, 0]);
            for (const b of ORDERED) {
                if (a.userId === b.userId) continue;
                const ab = sign(compareUsersStable(a, b));
                const ba = sign(compareUsersStable(b, a));
                expect([a.userId, b.userId, ab !== 0, ab + ba]).toEqual([a.userId, b.userId, true, 0]);
            }
        }
    });

    it('評価ポイントの compareUsers で順番が決まるときは、その答えのまま（人の ID は、最後の決め手にだけ使う）', () => {
        for (const a of ORDERED) {
            for (const b of ORDERED) {
                const base = sign(evaluationPointsReport.compareUsers(a, b));
                if (base !== 0) expect([a.userId, b.userId, sign(compareUsersStable(a, b))]).toEqual([a.userId, b.userId, base]);
            }
        }
        // compareUsers では決まらない2人（並び順も名前も同じ）だけ、ID で決める
        const [k1, k2] = [ORDERED[2], ORDERED[3]];
        expect(sign(evaluationPointsReport.compareUsers(k1, k2))).toBe(0);
        expect([sign(compareUsersStable(k1, k2)), sign(compareUsersStable(k2, k1))]).toEqual([-1, 1]);
    });
});

// ================================================================ 月の集計

/**
 * 2026年9月の記録（DB が月で絞ったあとの結果を、このテストが決めて返す。並びは、ばらばら）。
 *   職長A        … 職長 2日（1,500円）・ほかの人の班に入った日 1日（200円）・自分で付けた確認待ち 1件
 *   作業員1      … 職長以外 2日（月の途中で 200円 → 300円 に変わった）・今は使っていない手当 1日（100円）
 *   常用の親方1  … 職長 1日・職長以外 2日・確認待ち 1件（支払明細書の対象者＝常用の一人親方）
 *   辞めた人・協力会社・並び順の無い2人 … 職長以外 1日ずつ
 *   ghost        … User の行が無い人。確認待ちだけ
 */
const RECORDS = [
    { userId: 'worker3', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
    { userId: 'worker1', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
    { userId: 'ghost', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'pending' },
    { userId: 'foremanA', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'confirmed' },
    { userId: 'joyo1', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
    { userId: 'worker1', itemId: 'large', payRole: 'member', amount: 300, status: 'confirmed' },
    { userId: 'foremanA', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'pending' },
    { userId: 'retired', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
    { userId: 'foremanA', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
    { userId: 'joyo1', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'confirmed' },
    { userId: 'partner1', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
    { userId: 'worker1', itemId: 'old', payRole: 'member', amount: 100, status: 'confirmed' },
    { userId: 'foremanA', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'confirmed' },
    { userId: 'joyo1', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
    { userId: 'joyo1', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'pending' },
    { userId: 'worker4', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
];
/** この月に記録のある人（8人） */
const RECORD_USER_IDS = ['worker3', 'worker1', 'ghost', 'foremanA', 'joyo1', 'retired', 'partner1', 'worker4'];

/** 手当（DB が sortOrder → createdAt の順で返したあとの結果） */
const ITEM_ROWS = [
    { id: 'large', name: '大規模手当', isActive: true },
    { id: 'old', name: '旧手当', isActive: false },        // 今は使っていないが、この月に記録がある
    { id: 'spare', name: '予備の手当', isActive: true },    // 使用中だが、この月の記録は無い
    { id: 'unused', name: '使わない手当', isActive: false }, // 使っていなくて、記録も無い
];

/**
 * user.findMany の答え（「在籍している人＋記録のある人」を、このテストが決めて返す。並びは、ばらばら）。
 * role は DB の値のまま（大文字が混ざる）。ghost は User の行が無いので、ここに居ない。
 */
const USERS = [
    { id: 'admin1', displayName: '管理者1', role: 'ADMIN', isActive: true, dispatchSortOrder: null },
    { id: 'worker3', displayName: 'いとう', role: 'worker', isActive: true, dispatchSortOrder: null },
    { id: 'joyo2', displayName: '常用の親方2', role: 'worker', isActive: true, dispatchSortOrder: 7 },
    { id: 'worker4', displayName: 'アオキ', role: 'WORKER', isActive: true, dispatchSortOrder: null },
    { id: 'joyo1', displayName: '常用の親方1', role: 'FOREMAN1', isActive: true, dispatchSortOrder: 5 },
    { id: 'retired', displayName: '作業員2（退職）', role: 'WORKER', isActive: false, dispatchSortOrder: 3 },
    { id: 'pm1', displayName: '協力会社のメンバー', role: 'PARTNER_MEMBER', isActive: true, dispatchSortOrder: 6 },
    { id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: true, dispatchSortOrder: 2 },
    { id: 'manager1', displayName: 'マネージャー1', role: 'Manager', isActive: true, dispatchSortOrder: 4 },
    { id: 'partner1', displayName: '協力会社A', role: 'PARTNER', isActive: true, dispatchSortOrder: 0 },
    { id: 'foremanA', displayName: '職長A', role: 'FOREMAN2', isActive: true, dispatchSortOrder: 1 },
];

/** 支払明細書の対象者（常用の一人親方）に登録されている人 */
const JOYO_ROWS = [{ userId: 'joyo1' }, { userId: 'joyo2' }];

const TOTAL_KEYS: (keyof AllowanceTotals)[] = [
    'foremanDays', 'foremanAmount', 'memberDays', 'memberAmount', 'totalDays', 'totalAmount', 'pendingCount', 'pendingAmount',
];
const ZERO_TOTALS: AllowanceTotals = {
    foremanDays: 0, foremanAmount: 0, memberDays: 0, memberAmount: 0, totalDays: 0, totalAmount: 0, pendingCount: 0, pendingAmount: 0,
};

/** 月の集計を読む（null が返ったら、その場でテストを落とす） */
const summaryOf = async (month: unknown = '2026-09') => {
    const summary = await loadAllowanceSummary(month);
    if (!summary) throw new Error(`月の集計が null で返りました: ${String(month)}`);
    return summary;
};

describe('loadAllowanceSummary（月の集計）', () => {
    beforeEach(() => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue(RECORDS);
        mock(prisma.allowanceItem.findMany).mockResolvedValue(ITEM_ROWS);
        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue(null); // 締めていない
        mock(prisma.user.findMany).mockResolvedValue(USERS);
        mock(prisma.joyoContractor.findMany).mockResolvedValue(JOYO_ROWS);
    });

    it("月の形が違えば null（'0026-09' のように、年が 2000〜2999 でない月も）。DB は読まない", async () => {
        for (const bad of BAD_MONTHS) {
            expect([bad, await loadAllowanceSummary(bad)]).toEqual([bad, null]);
        }
        expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
        expect(prisma.allowanceItem.findMany).not.toHaveBeenCalled();
        expect(prisma.allowanceMonthClose.findUnique).not.toHaveBeenCalled();
        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.joyoContractor.findMany).not.toHaveBeenCalled();
    });

    it('記録は「月の1日（UTC 0時）以上・翌月1日より前」で読む。手当は sortOrder → createdAt の順、締めは「その月」の行を読む', async () => {
        await summaryOf('2026-09');
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(firstArg(prisma.allowanceRecord.findMany).where).toEqual({ date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') } });
        // 集計に要る列（人・手当・職長／職長以外・金額・状態）を読む
        expect(firstArg(prisma.allowanceRecord.findMany).select).toMatchObject({ userId: true, itemId: true, payRole: true, amount: true, status: true });

        expect(prisma.allowanceItem.findMany).toHaveBeenCalledTimes(1);
        expect(firstArg(prisma.allowanceItem.findMany).orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
        // 手当は、使っていないものも読む（この月に記録のある、使っていない手当を出すため）
        expect(firstArg(prisma.allowanceItem.findMany).where).toBeUndefined();

        expect(prisma.allowanceMonthClose.findUnique).toHaveBeenCalledTimes(1);
        expect(firstArg(prisma.allowanceMonthClose.findUnique).where).toEqual({ month: '2026-09' });
        // 金額の表（AllowanceRate）は読まない（合計は、記録に写してある金額の足し算）
        expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
    });

    it('month・startDate・endDate は、月の1日〜末日（うるう年の2月・年をまたぐ12月・受け付ける年の両端も）。読む範囲と締めの月も、その月', async () => {
        const cases: [string, string, string, string][] = [
            // 月,       1日,          末日,         翌月1日（記録を読む範囲の終わり）
            ['2026-09', '2026-09-01', '2026-09-30', '2026-10-01'],
            ['2024-02', '2024-02-01', '2024-02-29', '2024-03-01'],
            ['2026-02', '2026-02-01', '2026-02-28', '2026-03-01'],
            ['2026-12', '2026-12-01', '2026-12-31', '2027-01-01'],
            // 年は 2000〜2999 を受け付ける（両端）
            ['2000-01', '2000-01-01', '2000-01-31', '2000-02-01'],
            ['2999-12', '2999-12-01', '2999-12-31', '3000-01-01'],
        ];
        for (const [month, start, end, next] of cases) {
            mock(prisma.allowanceRecord.findMany).mockClear();
            mock(prisma.allowanceMonthClose.findUnique).mockClear();
            const s = await summaryOf(month);
            expect([s.month, s.startDate, s.endDate]).toEqual([month, start, end]);
            expect(firstArg(prisma.allowanceRecord.findMany).where).toEqual({ date: { gte: utc0(start), lt: utc0(next) } });
            expect(firstArg(prisma.allowanceMonthClose.findUnique).where).toEqual({ month });
        }
    });

    it('User は where にロールを書かずに読む: 記録があるときは「在籍している人 または 記録のある人」、無いときは「在籍している人」', async () => {
        await summaryOf();
        expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        const where = firstArg(prisma.user.findMany).where as { OR: [unknown, { id: { in: string[] } }] };
        expect(where).toEqual({ OR: [{ isActive: true }, { id: { in: expect.any(Array) } }] });
        // 記録のある人（辞めた人・協力会社・User の行が無い人も）。同じ人は1回だけ
        expect(sorted(where.OR[1].id.in)).toEqual(sorted(RECORD_USER_IDS));
        // 並べるのに使う順番と、在籍・ロールの判定に使う列を読む
        expect(firstArg(prisma.user.findMany).select).toMatchObject({ id: true, displayName: true, role: true, isActive: true, dispatchSortOrder: true });

        mock(prisma.user.findMany).mockClear();
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);
        await summaryOf();
        expect(firstArg(prisma.user.findMany).where).toEqual({ isActive: true });
    });

    it('people は「この月に記録のある人」だけ（辞めた人・協力会社でも、記録があれば出す。記録が1件も無い在籍者は出さない）', async () => {
        const s = await summaryOf();
        expect(sorted(s.people.map((p) => p.userId))).toEqual(sorted(RECORD_USER_IDS));
        // 辞めた人・協力会社は、記録があるので出る。名前はそのまま・role は小文字
        expect(s.people.find((p) => p.userId === 'retired')).toMatchObject({ displayName: '作業員2（退職）', role: 'worker', totalDays: 1, totalAmount: 200 });
        expect(s.people.find((p) => p.userId === 'partner1')).toMatchObject({ displayName: '協力会社A', role: 'partner', totalDays: 1, totalAmount: 200 });
        // 在籍していても、この月に記録が無い人（管理者・マネージャー・記録の無い一人親方・協力会社のメンバー）は出ない
        for (const id of ['admin1', 'manager1', 'joyo2', 'pm1']) {
            expect([id, s.people.some((p) => p.userId === id)]).toEqual([id, false]);
        }
    });

    it('確認待ちだけの人も people に出す（合計は 0。確認待ちの件数と金額だけ）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            { userId: 'foremanA', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'pending' },
        ]);
        const s = await summaryOf();
        expect(s.people).toEqual([{
            userId: 'foremanA', displayName: '職長A', role: 'foreman2', isJoyo: false, byItem: {},
            foremanDays: 0, foremanAmount: 0, memberDays: 0, memberAmount: 0,
            totalDays: 0, totalAmount: 0, pendingCount: 1, pendingAmount: 1500,
        }]);
    });

    it('User の行が無い人は「（不明）」で出す（role は空。支払明細書の対象者に登録されていなければ、社員の側に数える）', async () => {
        const s = await summaryOf();
        expect(s.people.find((p) => p.userId === 'ghost')).toEqual({
            userId: 'ghost', displayName: '（不明）', role: '', isJoyo: false, byItem: {},
            foremanDays: 0, foremanAmount: 0, memberDays: 0, memberAmount: 0,
            totalDays: 0, totalAmount: 0, pendingCount: 1, pendingAmount: 1500,
        });
        expect(UNKNOWN_USER_NAME).toBe('（不明）');
    });

    it('people の並び: dispatchSortOrder の小さい順 → null は最後 → 名前の日本語順（記録の並び・User の並びによらない）', async () => {
        const s = await summaryOf();
        expect(s.people.map((p) => [p.userId, p.displayName, p.role])).toEqual([
            ['partner1', '協力会社A', 'partner'],        // 0（0 も「順番あり」。null 扱いにしない）
            ['foremanA', '職長A', 'foreman2'],           // 1
            ['worker1', '作業員1', 'worker'],            // 2
            ['retired', '作業員2（退職）', 'worker'],     // 3
            ['joyo1', '常用の親方1', 'foreman1'],         // 5
            ['ghost', '（不明）', ''],                    // ここから順番の無い人（名前の日本語順）
            ['worker4', 'アオキ', 'worker'],              // カタカナとひらがなは、文字コードの順ではなく五十音順
            ['worker3', 'いとう', 'worker'],
        ]);
        // 記録の並びを逆にしても同じ
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([...RECORDS].reverse());
        mock(prisma.user.findMany).mockResolvedValue([...USERS].reverse());
        expect((await summaryOf()).people.map((p) => p.userId)).toEqual(s.people.map((p) => p.userId));
    });

    it('同じ並び順・同じ名前の人は、人の ID 順に並ぶ（「（不明）」が2人いても、記録の並び・User の並びによらず、毎回同じ）', async () => {
        // twinA・twinB は、名前も並び順も同じ2人。ghostA・ghostB は User の行が無い2人（どちらも「（不明）」）
        const twins = [
            { id: 'twinB', displayName: 'ふたご', role: 'WORKER', isActive: true, dispatchSortOrder: 3 },
            { id: 'twinA', displayName: 'ふたご', role: 'worker', isActive: true, dispatchSortOrder: 3 },
        ];
        const records = ['ghostB', 'twinB', 'ghostA', 'twinA'].map((userId) => ({ userId, itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' }));
        for (const recordRows of [records, [...records].reverse()]) {
            for (const userRows of [twins, [...twins].reverse()]) {
                mock(prisma.allowanceRecord.findMany).mockResolvedValue(recordRows);
                mock(prisma.user.findMany).mockResolvedValue(userRows);
                const s = await summaryOf();
                expect(s.people.map((p) => [p.userId, p.displayName])).toEqual([
                    ['twinA', 'ふたご'], ['twinB', 'ふたご'], ['ghostA', '（不明）'], ['ghostB', '（不明）'],
                ]);
                expect(s.eligiblePeople.map((p) => p.userId)).toEqual(['twinA', 'twinB']);
            }
        }
    });

    it('人ごとの数字: 職長・職長以外の日数と金額、合計、確認待ち（確認待ちは合計に入れない）。金額は、記録に写してある金額の足し算', async () => {
        const s = await summaryOf();
        const byId = Object.fromEntries(s.people.map((p) => [p.userId, p]));
        // 職長A: 職長 2日 ＋ 職長以外 1日。自分で付けた確認待ち（1,500円）は合計に入らない
        expect(byId.foremanA).toEqual({
            userId: 'foremanA', displayName: '職長A', role: 'foreman2', isJoyo: false,
            byItem: { large: { foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200 } },
            foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200,
            totalDays: 3, totalAmount: 3200, pendingCount: 1, pendingAmount: 1500,
        });
        // 作業員1: 月の途中で 200円 → 300円 に変わった。合計は 200 + 300 +（旧手当）100。手当ごとの内訳に分かれる
        expect(byId.worker1).toEqual({
            userId: 'worker1', displayName: '作業員1', role: 'worker', isJoyo: false,
            byItem: {
                large: { foremanDays: 0, foremanAmount: 0, memberDays: 2, memberAmount: 500 },
                old: { foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 100 },
            },
            foremanDays: 0, foremanAmount: 0, memberDays: 3, memberAmount: 600,
            totalDays: 3, totalAmount: 600, pendingCount: 0, pendingAmount: 0,
        });
        // 常用の親方1: 職長 1日 ＋ 職長以外 2日 ＋ 確認待ち 1件
        expect(byId.joyo1).toEqual({
            userId: 'joyo1', displayName: '常用の親方1', role: 'foreman1', isJoyo: true,
            byItem: { large: { foremanDays: 1, foremanAmount: 1500, memberDays: 2, memberAmount: 400 } },
            foremanDays: 1, foremanAmount: 1500, memberDays: 2, memberAmount: 400,
            totalDays: 3, totalAmount: 1900, pendingCount: 1, pendingAmount: 1500,
        });
    });

    it('DB の知らない文字: payRole は職長以外に、status は確定に数える（金額の大きいほうに数えない・合計から落とさない）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            { userId: 'worker1', itemId: 'large', payRole: 'FOREMAN', amount: 1500, status: 'confirmed' },
            { userId: 'worker1', itemId: 'large', payRole: 'member', amount: 200, status: 'PENDING' },
            { userId: 'worker1', itemId: 'large', payRole: '', amount: 300, status: '' },
        ]);
        const s = await summaryOf();
        expect(s.totals).toEqual({
            foremanDays: 0, foremanAmount: 0, memberDays: 3, memberAmount: 2000, totalDays: 3, totalAmount: 2000, pendingCount: 0, pendingAmount: 0,
        });
    });

    it('isJoyo: 支払明細書の対象者（JoyoContractor）に登録されている人が true。「読めた User の ID ＋ 記録のある人の ID」で引き（同じ ID は1回）、「使わない」かどうかでは絞らない', async () => {
        const s = await summaryOf();
        expect(prisma.joyoContractor.findMany).toHaveBeenCalledTimes(1);
        const where = firstArg(prisma.joyoContractor.findMany).where as { userId: { in: string[] } };
        // isActive などの条件を足していない（今「使わない」になっている対象者も、一人親方として数える）
        expect(where).toEqual({ userId: { in: expect.any(Array) } });
        // 読めた User の全員（記録の無い在籍者も）＋ 記録はあるが User の行が無い ghost。両方にいる人（作業員1 など）も1回だけ
        expect(sorted(where.userId.in)).toEqual(sorted([...USERS.map((u) => u.id), 'ghost']));
        expect(Object.fromEntries(s.people.map((p) => [p.userId, p.isJoyo]))).toEqual({
            partner1: false, foremanA: false, worker1: false, retired: false, joyo1: true, ghost: false, worker4: false, worker3: false,
        });

        // 返ってきた userId の人が true になる（登録されている人を変えると、答えも変わる）
        mock(prisma.joyoContractor.findMany).mockResolvedValue([{ userId: 'worker1' }, { userId: 'retired' }]);
        const other = await summaryOf();
        expect(other.people.filter((p) => p.isJoyo).map((p) => p.userId)).toEqual(['worker1', 'retired']);
        expect(other.eligiblePeople.filter((p) => p.isJoyo).map((p) => p.userId)).toEqual(['worker1']);
    });

    it('User の行が無い人でも、支払明細書の対象者に登録されていれば isJoyo: true（一人親方の合計に入り、社員の合計には入らない）', async () => {
        // ghost（User の行が消えた一人親方）: 職長以外 2日 ＋ 確認待ち 1件。作業員1: 職長以外 1日
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            { userId: 'ghost', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
            { userId: 'worker1', itemId: 'large', payRole: 'member', amount: 300, status: 'confirmed' },
            { userId: 'ghost', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
            { userId: 'ghost', itemId: 'large', payRole: 'foreman', amount: 1500, status: 'pending' },
        ]);
        mock(prisma.user.findMany).mockResolvedValue(USERS.filter((u) => u.id === 'worker1'));
        mock(prisma.joyoContractor.findMany).mockResolvedValue([{ userId: 'ghost' }]);
        const s = await summaryOf();
        // User の行が無い ghost の ID も、JoyoContractor を引く ID に入っている
        const where = firstArg(prisma.joyoContractor.findMany).where as { userId: { in: string[] } };
        expect(sorted(where.userId.in)).toEqual(['ghost', 'worker1']);
        expect(s.people.map((p) => [p.userId, p.displayName, p.isJoyo])).toEqual([['worker1', '作業員1', false], ['ghost', '（不明）', true]]);
        expect(s.totalsByKind).toEqual({
            employee: { ...ZERO_TOTALS, memberDays: 1, memberAmount: 300, totalDays: 1, totalAmount: 300 },
            joyo: { ...ZERO_TOTALS, memberDays: 2, memberAmount: 400, totalDays: 2, totalAmount: 400, pendingCount: 1, pendingAmount: 1500 },
        });
    });

    it('User が1人も読めなくても、記録のある人がいれば JoyoContractor を読む（記録のある人の ID で引く）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            { userId: 'ghost', itemId: 'large', payRole: 'member', amount: 200, status: 'confirmed' },
        ]);
        mock(prisma.user.findMany).mockResolvedValue([]);
        mock(prisma.joyoContractor.findMany).mockResolvedValue([{ userId: 'ghost' }]);
        const s = await summaryOf();
        expect(prisma.joyoContractor.findMany).toHaveBeenCalledTimes(1);
        expect(firstArg(prisma.joyoContractor.findMany).where).toEqual({ userId: { in: ['ghost'] } });
        expect(s.people.map((p) => [p.userId, p.isJoyo])).toEqual([['ghost', true]]);
        expect(s.totalsByKind).toEqual({
            employee: ZERO_TOTALS,
            joyo: { ...ZERO_TOTALS, memberDays: 1, memberAmount: 200, totalDays: 1, totalAmount: 200 },
        });
    });

    it('totals は people の足し算。totalsByKind は、社員（給与に付ける分）と常用の一人親方（支払明細書に載せる分）に分けた合計で、足すと totals になる', async () => {
        const s = await summaryOf();
        expect(s.totals).toEqual({
            foremanDays: 3, foremanAmount: 4500, memberDays: 10, memberAmount: 2000, totalDays: 13, totalAmount: 6500, pendingCount: 3, pendingAmount: 4500,
        });
        expect(s.totalsByKind).toEqual({
            employee: { foremanDays: 2, foremanAmount: 3000, memberDays: 8, memberAmount: 1600, totalDays: 10, totalAmount: 4600, pendingCount: 2, pendingAmount: 3000 },
            joyo: { foremanDays: 1, foremanAmount: 1500, memberDays: 2, memberAmount: 400, totalDays: 3, totalAmount: 1900, pendingCount: 1, pendingAmount: 1500 },
        });
        for (const key of TOTAL_KEYS) {
            expect([key, s.totalsByKind.employee[key] + s.totalsByKind.joyo[key]]).toEqual([key, s.totals[key]]);
            expect([key, s.people.reduce((sum, p) => sum + p[key], 0)]).toEqual([key, s.totals[key]]);
        }
    });

    it('totalsByKind: 対象者に登録されている人が変われば、分け方も変わる（だれも登録されていなければ、全部が社員の合計）', async () => {
        mock(prisma.joyoContractor.findMany).mockResolvedValue([{ userId: 'foremanA' }]);
        const s = await summaryOf();
        expect(s.totalsByKind.joyo).toEqual({
            foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200, totalDays: 3, totalAmount: 3200, pendingCount: 1, pendingAmount: 1500,
        });
        expect(s.totalsByKind.employee).toEqual({
            foremanDays: 1, foremanAmount: 1500, memberDays: 9, memberAmount: 1800, totalDays: 10, totalAmount: 3300, pendingCount: 2, pendingAmount: 3000,
        });

        mock(prisma.joyoContractor.findMany).mockResolvedValue([]);
        const none = await summaryOf();
        expect(none.totalsByKind).toEqual({ employee: none.totals, joyo: ZERO_TOTALS });
        expect(none.totals).toEqual(s.totals);
    });

    it('items は「使用中の手当」＋「この月に記録のある手当」（使っていなくて記録も無い手当は出さない）。並びは、読んだ順のまま', async () => {
        const s = await summaryOf();
        expect(s.items).toEqual([
            { id: 'large', name: '大規模手当', isActive: true },
            { id: 'old', name: '旧手当', isActive: false },
            { id: 'spare', name: '予備の手当', isActive: true },
        ]);

        // 確認待ちの記録しか無い手当も「記録のある手当」
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            { userId: 'foremanA', itemId: 'unused', payRole: 'foreman', amount: 1500, status: 'pending' },
        ]);
        expect((await summaryOf()).items.map((i) => i.id)).toEqual(['large', 'spare', 'unused']);
    });

    it('closed: 締めの行があれば「締めた人・締めた日時（ISO 文字列）」、無ければ null', async () => {
        expect((await summaryOf()).closed).toBeNull();
        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue({ closedByName: '管理者1', closedAt: new Date('2026-10-05T01:02:03.456Z') });
        expect((await summaryOf()).closed).toEqual({ closedByName: '管理者1', closedAt: '2026-10-05T01:02:03.456Z' });
    });

    it('eligiblePeople は、在籍していて、手当をもらえるロール（DB の大文字でも）の全員。協力会社・辞めた人は入らない。role は小文字・isJoyo つき・並びは people と同じ決まり', async () => {
        const s = await summaryOf();
        expect(s.eligiblePeople).toEqual([
            { userId: 'foremanA', displayName: '職長A', role: 'foreman2', isJoyo: false },
            { userId: 'worker1', displayName: '作業員1', role: 'worker', isJoyo: false },
            { userId: 'manager1', displayName: 'マネージャー1', role: 'manager', isJoyo: false },
            { userId: 'joyo1', displayName: '常用の親方1', role: 'foreman1', isJoyo: true },
            { userId: 'joyo2', displayName: '常用の親方2', role: 'worker', isJoyo: true },
            { userId: 'worker4', displayName: 'アオキ', role: 'worker', isJoyo: false },
            { userId: 'worker3', displayName: 'いとう', role: 'worker', isJoyo: false },
            { userId: 'admin1', displayName: '管理者1', role: 'admin', isJoyo: false },
        ]);
        // 協力会社（PARTNER）・協力会社のメンバー（PARTNER_MEMBER）は在籍していても入らない。辞めた人は、対象のロールでも入らない
        for (const id of ['partner1', 'pm1', 'retired', 'ghost']) {
            expect([id, s.eligiblePeople.some((p) => p.userId === id)]).toEqual([id, false]);
        }
        // 並べるのに使う dispatchSortOrder は、返す形に入れない
        for (const p of s.eligiblePeople) {
            expect(Object.keys(p).sort()).toEqual(['displayName', 'isJoyo', 'role', 'userId']);
        }
        // User の並びを逆にしても同じ
        mock(prisma.user.findMany).mockResolvedValue([...USERS].reverse());
        expect((await summaryOf()).eligiblePeople).toEqual(s.eligiblePeople);
    });

    it('記録が無い月: people は空・合計は全部 0・items は使用中の手当だけ。eligiblePeople は、記録が無くても出す', async () => {
        const withRecords = await summaryOf();
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);
        // 記録のある人を読まないので、辞めた人は DB から返ってこない
        mock(prisma.user.findMany).mockResolvedValue(USERS.filter((u) => u.isActive));
        const s = await summaryOf();
        expect(s.people).toEqual([]);
        expect(s.totals).toEqual(ZERO_TOTALS);
        expect(s.totalsByKind).toEqual({ employee: ZERO_TOTALS, joyo: ZERO_TOTALS });
        expect(s.items.map((i) => i.id)).toEqual(['large', 'spare']);
        expect(s.closed).toBeNull();
        expect(s.eligiblePeople).toEqual(withRecords.eligiblePeople);
    });

    it('引く相手が1人もいないとき（記録も在籍者も無い）は、JoyoContractor を読まずに、空の集計を返す', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);
        mock(prisma.user.findMany).mockResolvedValue([]);
        const s = await summaryOf();
        expect(prisma.joyoContractor.findMany).not.toHaveBeenCalled();
        expect([s.people, s.eligiblePeople, s.totals]).toEqual([[], [], ZERO_TOTALS]);
    });

    it('読むだけ: 何も書かない・書き込みの鍵も取らない', async () => {
        await summaryOf();
        noWrites();
    });
});

// ================================================================ 本人の手当

const ME = 'foremanA';
const NOTICE = '手当は、翌月の給与といっしょに支払います';

/**
 * 本人（職長A）の記録の1行。
 * select に無い列（付けた人・メモ など）も、わざと入れてある（DB から読めてしまっても、返さないことを確かめるため）
 */
const myRow = (id: string, dateKey: string, payRole: string, amount: number, status = 'confirmed') => ({
    id, date: utc0(dateKey), itemId: 'large', itemName: '大規模手当', payRole, amount, status,
    userId: ME, source: 'manual', createdBy: 'admin1', createdByName: '管理者1', note: 'ひみつのメモ',
});

/** 9月の職長A の記録（DB が「日付の古い順 → 付けた順」で返したあとの結果） */
const MY_ROWS = [
    myRow('m1', '2026-09-01', 'member', 200),               // ほかの人の班に入った日
    myRow('m2', '2026-09-02', 'foreman', 1500),
    myRow('m3', '2026-09-10', 'member', 200),
    myRow('m4', '2026-09-16', 'member', 300),               // 月の途中で、職長以外の金額が 200円 → 300円 に変わった
    myRow('m5', '2026-09-20', 'foreman', 1500, 'pending'),  // 自分で付けた分（確認待ち）
    myRow('m6', '2026-09-30', 'foreman', 1500),
];

/** 本人の手当を読む（null が返ったら、その場でテストを落とす） */
const myOf = async (userId: string = ME, month: unknown = '2026-09') => {
    const my = await loadMyAllowance(userId, month);
    if (!my) throw new Error(`本人の手当が null で返りました: ${String(month)}`);
    return my;
};

describe('loadMyAllowance（本人の、その月の手当）', () => {
    beforeEach(() => {
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: true, memberNotice: NOTICE });
        mock(prisma.allowanceRecord.findMany).mockResolvedValue(MY_ROWS);
        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue(null); // 締めていない
    });

    it("月の形が違えば null（'0026-09' のように、年が 2000〜2999 でない月も）。DB は読まない（公開の設定も）", async () => {
        for (const bad of BAD_MONTHS) {
            expect([bad, await loadMyAllowance(ME, bad)]).toEqual([bad, null]);
        }
        expect(prisma.allowanceSetting.findUnique).not.toHaveBeenCalled();
        expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
        expect(prisma.allowanceMonthClose.findUnique).not.toHaveBeenCalled();
    });

    it('読むのは本人の分だけ（where の userId が、渡した ID）。その月の範囲を、日付の古い順 → 付けた順で読む', async () => {
        await myOf(ME, '2026-09');
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(firstArg(prisma.allowanceRecord.findMany).where).toEqual({
            userId: 'foremanA',
            date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') },
        });
        expect(firstArg(prisma.allowanceRecord.findMany).orderBy).toEqual([{ date: 'asc' }, { createdAt: 'asc' }]);

        // だれの分を読むかは、渡した ID だけで決まる
        mock(prisma.allowanceRecord.findMany).mockClear();
        await myOf('worker1', '2026-12');
        expect(firstArg(prisma.allowanceRecord.findMany).where).toEqual({
            userId: 'worker1',
            date: { gte: utc0('2026-12-01'), lt: utc0('2027-01-01') },
        });
    });

    it('ID が空文字・文字列でないときは例外にする。DB は読まない（where の userId が外れて、全員の分を読んでしまわないように）', async () => {
        for (const bad of ['', undefined, null, 0, 123, {}, ['foremanA']]) {
            await expect(loadMyAllowance(bad as unknown as string, '2026-09')).rejects.toThrow('userId が空です');
        }
        expect(prisma.allowanceSetting.findUnique).not.toHaveBeenCalled();
        expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
        expect(prisma.allowanceMonthClose.findUnique).not.toHaveBeenCalled();
    });

    it('付けた人の名前・メモは、DB からも読まない（行と明細に要る列だけを読む）', async () => {
        await myOf();
        const select = firstArg(prisma.allowanceRecord.findMany).select ?? {};
        expect(select).toMatchObject({ id: true, date: true, itemId: true, itemName: true, payRole: true, amount: true, status: true });
        for (const column of ['createdBy', 'createdByName', 'confirmedByName', 'note', 'source', 'foremanId']) {
            expect([column, select[column]]).toEqual([column, undefined]);
        }
    });

    it('返す形: 月・注意書き・締め・「日数 × 金額 ＝ 合計」の行・合計・確認待ち・明細', async () => {
        expect(await myOf()).toEqual({
            month: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30',
            notice: NOTICE, closed: false,
            lines: [
                { itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500, days: 2, total: 3000 },
                { itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 300, days: 1, total: 300 },
                { itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, days: 2, total: 400 },
            ],
            totalDays: 5, totalAmount: 3700, pendingCount: 1, pendingAmount: 1500,
            records: [
                { id: 'm6', date: '2026-09-30', itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'confirmed' },
                { id: 'm5', date: '2026-09-20', itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'pending' },
                { id: 'm4', date: '2026-09-16', itemName: '大規模手当', payRole: 'member', amount: 300, status: 'confirmed' },
                { id: 'm3', date: '2026-09-10', itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed' },
                { id: 'm2', date: '2026-09-02', itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'confirmed' },
                { id: 'm1', date: '2026-09-01', itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed' },
            ],
        });
    });

    it('lines: 「職長／職長以外・1日の金額」ごとの「日数 × 金額 ＝ 合計」。確定だけ・職長が先・月の途中で金額が変わった月は、金額ごとに行が分かれる', async () => {
        const my = await myOf();
        expect(my.lines.map((l) => [l.payRole, l.amount, l.days, l.total])).toEqual([
            ['foreman', 1500, 2, 3000],  // 確認待ちの1件（1,500円）は入らない
            ['member', 300, 1, 300],     // 金額が変わったあとの分
            ['member', 200, 2, 400],     // 変わる前の分
        ]);
        for (const line of my.lines) expect([line.itemName, line.days * line.amount]).toEqual(['大規模手当', line.total]);
        // 行を足すと、合計の日数と金額になる
        expect([my.lines.reduce((sum, l) => sum + l.days, 0), my.lines.reduce((sum, l) => sum + l.total, 0)]).toEqual([my.totalDays, my.totalAmount]);
    });

    it('totalDays・totalAmount は確定だけ。確認待ちは pendingCount・pendingAmount に出す（合計には入れない）', async () => {
        const my = await myOf();
        expect([my.totalDays, my.totalAmount, my.pendingCount, my.pendingAmount]).toEqual([5, 3700, 1, 1500]);

        // 確認待ちだけの月: 合計は 0・行は無い。明細には出る
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            myRow('p1', '2026-09-05', 'foreman', 1500, 'pending'),
            myRow('p2', '2026-09-06', 'foreman', 1500, 'pending'),
        ]);
        const pendingOnly = await myOf();
        expect([pendingOnly.totalDays, pendingOnly.totalAmount, pendingOnly.pendingCount, pendingOnly.pendingAmount]).toEqual([0, 0, 2, 3000]);
        expect(pendingOnly.lines).toEqual([]);
        expect(pendingOnly.records.map((r) => [r.id, r.status])).toEqual([['p2', 'pending'], ['p1', 'pending']]);
    });

    it('records は日付の新しい順（同じ日は、後から付けたほうが先）', async () => {
        const my = await myOf();
        expect(my.records.map((r) => [r.id, r.date])).toEqual([
            ['m6', '2026-09-30'], ['m5', '2026-09-20'], ['m4', '2026-09-16'], ['m3', '2026-09-10'], ['m2', '2026-09-02'], ['m1', '2026-09-01'],
        ]);

        // 同じ日に手当が2つ（DB は、付けた順で返す）
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            myRow('first', '2026-09-10', 'member', 200),
            { ...myRow('second', '2026-09-10', 'member', 100), itemId: 'other', itemName: '別の手当' },
            myRow('next-day', '2026-09-11', 'member', 200),
        ]);
        expect((await myOf()).records.map((r) => r.id)).toEqual(['next-day', 'second', 'first']);
    });

    it('records に入っている項目は id・date・itemName・payRole・amount・status だけ（付けた人の名前・メモ・itemId は入れない）', async () => {
        const my = await myOf();
        expect(my.records).toHaveLength(6);
        for (const r of my.records) {
            expect(Object.keys(r).sort()).toEqual(['amount', 'date', 'id', 'itemName', 'payRole', 'status']);
        }
        // DB の行に入っていた「付けた人・メモ」は、応答のどこにも出ない
        expect(JSON.stringify(my)).not.toMatch(/管理者1|admin1|ひみつ|manual/);
    });

    it('DB の知らない文字の payRole・status は、決まった値にそろえて返す（行も明細も）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            myRow('u1', '2026-09-01', 'FOREMAN', 1500, 'PENDING'),
            myRow('u2', '2026-09-02', '', 200, ''),
        ]);
        const my = await myOf();
        expect(my.records.map((r) => [r.id, r.payRole, r.status])).toEqual([['u2', 'member', 'confirmed'], ['u1', 'member', 'confirmed']]);
        expect(my.lines.map((l) => [l.payRole, l.amount, l.days, l.total])).toEqual([['member', 1500, 1, 1500], ['member', 200, 1, 200]]);
        expect([my.totalDays, my.totalAmount, my.pendingCount, my.pendingAmount]).toEqual([2, 1700, 0, 0]);
    });

    it('closed: 締めの行があれば true（金額が決まった月）、無ければ false。読むのは「その月」の行', async () => {
        expect((await myOf()).closed).toBe(false);
        expect(prisma.allowanceMonthClose.findUnique).toHaveBeenCalledTimes(1);
        expect(firstArg(prisma.allowanceMonthClose.findUnique).where).toEqual({ month: '2026-09' });

        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue({ month: '2026-09' });
        const closed = await myOf();
        expect(closed.closed).toBe(true);
        // 締めても、数字と明細は同じ
        expect([closed.totalDays, closed.totalAmount, closed.records.length]).toEqual([5, 3700, 6]);
    });

    it('closed: 締めの行を読む関数が undefined を返しても false（「null でなければ締めてある」とは読まない）', async () => {
        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue(undefined);
        expect((await myOf()).closed).toBe(false);
    });

    it('notice: 公開の設定（id が default の1行）の注意書き。注意書きが無い・設定の行が無いときは null', async () => {
        expect((await myOf()).notice).toBe(NOTICE);
        expect(prisma.allowanceSetting.findUnique).toHaveBeenCalledTimes(1);
        expect(firstArg(prisma.allowanceSetting.findUnique).where).toEqual({ id: 'default' });

        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: true, memberNotice: null });
        expect((await myOf()).notice).toBeNull();
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue(null);
        expect((await myOf()).notice).toBeNull();
    });

    it('month・startDate・endDate は、月の1日〜末日（うるう年の2月・年をまたぐ12月・受け付ける年の両端も）。締めも、その月の行を読む', async () => {
        const cases: [string, string, string, string][] = [
            // 月,       1日,          末日,         翌月1日（記録を読む範囲の終わり）
            ['2026-09', '2026-09-01', '2026-09-30', '2026-10-01'],
            ['2024-02', '2024-02-01', '2024-02-29', '2024-03-01'],
            ['2026-12', '2026-12-01', '2026-12-31', '2027-01-01'],
            // 年は 2000〜2999 を受け付ける（両端）
            ['2000-01', '2000-01-01', '2000-01-31', '2000-02-01'],
            ['2999-12', '2999-12-01', '2999-12-31', '3000-01-01'],
        ];
        for (const [month, start, end, next] of cases) {
            mock(prisma.allowanceRecord.findMany).mockClear();
            mock(prisma.allowanceMonthClose.findUnique).mockClear();
            const my = await myOf(ME, month);
            expect([my.month, my.startDate, my.endDate]).toEqual([month, start, end]);
            expect(firstArg(prisma.allowanceRecord.findMany).where).toEqual({ userId: ME, date: { gte: utc0(start), lt: utc0(next) } });
            expect(firstArg(prisma.allowanceMonthClose.findUnique).where).toEqual({ month });
        }
    });

    it('記録が無い月は、行も明細も空・数字は全部 0（null にはしない）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);
        expect(await myOf()).toEqual({
            month: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', notice: NOTICE, closed: false,
            lines: [], totalDays: 0, totalAmount: 0, pendingCount: 0, pendingAmount: 0, records: [],
        });
    });

    it('読むだけ: 何も書かない・書き込みの鍵も取らない', async () => {
        await myOf();
        noWrites();
    });
});

// ================================================================ 評価ポイントの一覧と同じ部品

describe('評価ポイントの一覧と同じ部品が、このファイルからも読める', () => {
    it('NO_STORE・UNKNOWN_USER_NAME・loadUserNames は、lib/evaluationPointsReport.ts のものと同じ', () => {
        expect(NO_STORE).toBe(evaluationPointsReport.NO_STORE);
        expect(NO_STORE).toEqual({ headers: { 'Cache-Control': 'no-store' } });
        expect(UNKNOWN_USER_NAME).toBe(evaluationPointsReport.UNKNOWN_USER_NAME);
        expect(UNKNOWN_USER_NAME).toBe('（不明）');
        expect(loadUserNames).toBe(evaluationPointsReport.loadUserNames);
    });

    it('loadUserNames: 人の ID → 表示名。在籍で絞らずに引く（辞めた人の記録にも名前を出すため）。同じ ID は1回だけ', async () => {
        mock(prisma.user.findMany).mockResolvedValue([
            { id: 'worker1', displayName: '作業員1' },
            { id: 'retired', displayName: '作業員2（退職）' },
        ]);
        const names = await loadUserNames(['worker1', 'retired', 'worker1', 'ghost']);
        expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        const where = firstArg(prisma.user.findMany).where as { id: { in: string[] } };
        expect(where).toEqual({ id: { in: expect.any(Array) } });
        expect(sorted(where.id.in)).toEqual(['ghost', 'retired', 'worker1']);
        expect([names.get('worker1'), names.get('retired'), names.get('ghost')]).toEqual(['作業員1', '作業員2（退職）', undefined]);
    });

    it('loadUserNames: ID を1つも渡さなければ、DB を読まずに空の Map を返す', async () => {
        expect((await loadUserNames([])).size).toBe(0);
        expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
});
