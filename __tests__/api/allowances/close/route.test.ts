/**
 * @jest-environment node
 *
 * POST /api/allowances/close（手当の月を締める・締めを外す）のテスト。
 *
 *   { month: 'YYYY-MM', action: 'close' }  … 締める。終わった月だけ・確認待ちが1件も無いときだけ
 *   { month: 'YYYY-MM', action: 'reopen' } … 締めを外す
 *   どちらも管理者（admin）だけ。マネージャーは締められない・外せない。
 *
 * route は lib/allowancesServer.ts の closeAllowanceMonth()・reopenAllowanceMonth() を本物のまま呼ぶ。
 * 差し替えているのは、jest.setup.ts の @/lib/prisma と @/lib/api/utils だけ。
 * prisma のモックは where を見ずに、テストが決めた答えを返すだけなので、
 * 「どの月を読んだか・書いたか」は、findUnique・findMany・create・deleteMany に渡した引数で確かめる。
 *
 * 月: 締める月には、もう終わった月（2026-09）を使う。
 * 「今日」を日本時間で決めているか（まだ終わっていない月・月が変わった瞬間）を確かめるテストだけ、時計を固定する（freezeNow）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { POST, dynamic } from '@/app/api/allowances/close/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;
/** モックの答えを決め直す（前のテストが決めた答えを消してから） */
const answer = (fn: unknown, value: unknown) => mock(fn).mockReset().mockResolvedValue(value);
/** そのモックの call 回目（0 始まり）の呼び出しに渡した、1つめの引数 */
const argsOf = <T = unknown>(fn: unknown, call = 0) => mock(fn).mock.calls[call][0] as T;
/** そのモックの call 回目の呼び出しが、全部のモックを通して何番目だったか（呼んだ順番を比べる用） */
const orderOf = (fn: unknown, call = 0) => mock(fn).mock.invocationCallOrder[call];

/** もう終わった月 */
const MONTH = '2026-09';
/** 締めた日時（allowanceMonthClose.create が返す closedAt） */
const CLOSED_AT = new Date('2026-10-01T00:30:00.000Z');
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

interface Body {
    ok?: boolean;
    month?: string;
    closed?: { closedByName: string; closedAt: string } | null;
    error?: string;
    details?: string;
}

const postRaw = async (rawBody: string) => {
    const res = await POST(new NextRequest('http://localhost/api/allowances/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
    }));
    return { status: res.status, body: (await res.json()) as Body, res };
};
const post = (body: Record<string, unknown>) => postRaw(JSON.stringify(body));
const closeMonth = (month: unknown = MONTH) => post({ month, action: 'close' });
const reopenMonth = (month: unknown = MONTH) => post({ month, action: 'reopen' });

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };

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

/** 手当の記録の1行（締めるときに読む列だけ） */
const row = (userId: string, payRole: string, amount: number, status = 'confirmed') => ({ userId, payRole, amount, status });

/**
 * 9月の記録（全部確定・5件・3人・合計 4,300円）:
 *   職長A … 職長として 2日（1,500円・2,000円）＋ 職長以外として 1日（300円）
 *   作業員1 … 職長以外 1日（200円）／作業員2 … 職長以外 1日（300円）
 */
const SEPTEMBER = [
    row('foremanA', 'foreman', 1500),
    row('foremanA', 'foreman', 2000),
    row('foremanA', 'member', 300),
    row('worker1', 'member', 200),
    row('worker2', 'member', 300),
];

/** 手当の書き込みの鍵（$executeRaw に渡した SQL） */
const lockSqls = () => mock(prisma.$executeRaw).mock.calls.map((c) => Array.from(c[0] as readonly string[]).join('?'));

/** 締めた月の表にも履歴にも、何も書いていないこと */
const noWrites = () => {
    expect(prisma.allowanceMonthClose.create).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.createMany).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.upsert).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.delete).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.deleteMany).not.toHaveBeenCalled();
    expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
};

/** DB に触っていないこと（トランザクションを開いていない・鍵も取っていない・読んでも書いてもいない） */
const noDbAccess = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.findUnique).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
    noWrites();
};

beforeEach(() => {
    jest.clearAllMocks();
    // requireAuth の既定のモックには name・username が無いので、テストごとに入れる
    loginAs(ADMIN);

    answer(prisma.allowanceMonthClose.findUnique, null);               // まだ締めていない
    answer(prisma.allowanceRecord.findMany, SEPTEMBER);                // その月の記録（確認待ちなし）
    answer(prisma.allowanceMonthClose.create, { closedAt: CLOSED_AT });
    // deleteMany は { count } を返すようにする（jest.fn() のままだと undefined が返り、route が 500 になる）
    answer(prisma.allowanceMonthClose.deleteMany, { count: 1 });       // 締めてあった（1行消えた）
    answer(prisma.allowanceLog.create, {});
});

afterEach(() => {
    jest.useRealTimers();
    // 締める・締めを外すは、手当の記録そのものを書き換えない。どのテストでも、書いていないこと
    expect(prisma.allowanceRecord.create).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.createMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.update).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.delete).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.deleteMany).not.toHaveBeenCalled();
});

// ================================================================ ログインと権限

describe('ログインと権限: 管理者（admin）だけ', () => {
    it('ログインしていなければ 401。DB に触らない', async () => {
        // 2回呼ぶので、応答は呼ばれるたびに作る（同じ応答の body は、1回しか読めない）
        mock(requireAuth).mockImplementation(async () => ({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }));
        expect((await closeMonth()).status).toBe(401);
        expect((await reopenMonth()).status).toBe(401);
        noDbAccess();
    });

    it('管理者以外（マネージャーも・職長・作業員・協力会社・税理士）は、締めるのも外すのも 403「権限がありません」。DB に触らない', async () => {
        const users = [
            { id: 'manager1', role: 'manager', name: 'マネージャー1' },
            { id: 'foremanA', role: 'foreman2', name: '職長A' },
            { id: 'foremanB', role: 'foreman1', name: '職長B' },
            { id: 'worker1', role: 'worker', name: '作業員1' },
            { id: 'partner1', role: 'partner', name: '協力会社' },
            { id: 'accountant1', role: 'accountant', name: '税理士' },
            { id: 'nobody', role: '', name: 'ロールなし' },
        ];
        for (const user of users) {
            loginAs(user);
            for (const r of [await closeMonth(), await reopenMonth()]) {
                expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
            }
        }
        // 入力の形が違っていても、先に権限で断る
        loginAs({ id: 'manager1', role: 'manager', name: 'マネージャー1' });
        const broken = await postRaw('これは JSON ではない');
        expect([broken.status, broken.body.error]).toEqual([403, '権限がありません']);
        noDbAccess();
    });
});

// ================================================================ 入力の形

describe('入力の形', () => {
    it("JSON でない・month が文字列でない・action が 'close' / 'reopen' 以外 → 400「入力が不正です」。DB に触らない", async () => {
        const cases: [string, Record<string, unknown>][] = [
            ['month が数字', { month: 202609, action: 'close' }],
            ['month が null', { month: null, action: 'close' }],
            ['month が無い', { action: 'reopen' }],
            ['month が配列', { month: [MONTH], action: 'reopen' }],
            ['action が無い', { month: MONTH }],
            ['action が知らない値', { month: MONTH, action: 'open' }],
            ['action が大文字', { month: MONTH, action: 'CLOSE' }],
            ['action が真偽値', { month: MONTH, action: true }],
            ['action が null', { month: MONTH, action: null }],
        ];
        for (const [label, body] of cases) {
            const r = await post(body);
            // 形のまちがいは validationErrorResponse。モックでは、文言が error ではなく details に入る
            expect([label, r.status, r.body.error, r.body.details]).toEqual([label, 400, 'Validation Error', '入力が不正です']);
        }
        for (const raw of ['これは JSON ではない', '"2026-09"', 'null', '[]', '5', '']) {
            const r = await postRaw(raw);
            expect([raw, r.status, r.body.details]).toEqual([raw, 400, '入力が不正です']);
        }
        noDbAccess();
    });
});

// ================================================================ close

describe("action: 'close'（締める）: 断るとき（どれも、締めた月の表・履歴に書かない）", () => {
    it('month の形が違う → 400「月が不正です」。DB に触らない', async () => {
        for (const month of ['2026-13', '2026-00', '2026-9', '202609', '2026/09', '2026-09-01', ' 2026-09', '']) {
            const r = await closeMonth(month);
            expect([month, r.status, r.body.error, r.body.details]).toEqual([month, 400, 'Validation Error', '月が不正です']);
        }
        noDbAccess();
    });

    it("年が 2000〜2999 でない月（'0026-09'・'1999-12'・'3000-01'）→ 400「月が不正です」。DB に触らない（別の月を締めてしまわない）", async () => {
        // '0026-09' は、Date が 1926年9月と読む。受け付けると、送った月とは別の月（1926-09）を締めてしまう
        for (const month of ['0026-09', '1999-12', '0000-01', '3000-01', '9999-12']) {
            const r = await closeMonth(month);
            expect([month, r.status, r.body.error, r.body.details]).toEqual([month, 400, 'Validation Error', '月が不正です']);
        }
        noDbAccess();
    });

    it('まだ終わっていない月（今月・先の月）→ 400「まだ終わっていない月は締められません」。DB に触らない', async () => {
        freezeNow('2026-10-04T03:00:00.000Z'); // 日本時間 2026-10-04 12:00
        for (const month of ['2026-10', '2026-11', '2027-01', '2099-12']) {
            const r = await closeMonth(month);
            expect([month, r.status, r.body.error]).toEqual([month, 400, 'まだ終わっていない月は締められません']);
        }
        noDbAccess();
    });

    it('「今日」は日本時間で決まる。月が変わった瞬間（日本時間）から、前の月を締められる', async () => {
        freezeNow('2026-09-30T14:59:59.000Z'); // 日本時間 9/30 23:59:59（まだ9月）
        const before = await closeMonth('2026-09');
        expect([before.status, before.body.error]).toEqual([400, 'まだ終わっていない月は締められません']);
        noDbAccess();

        freezeNow('2026-09-30T15:00:00.000Z'); // 日本時間 10/1 0:00（UTC ではまだ 9/30）
        const after = await closeMonth('2026-09');
        expect([after.status, after.body.ok, after.body.month]).toEqual([200, true, '2026-09']);
        expect(prisma.allowanceMonthClose.create).toHaveBeenCalledTimes(1);
        // 始まったばかりの10月は、まだ締められない
        const october = await closeMonth('2026-10');
        expect([october.status, october.body.error]).toEqual([400, 'まだ終わっていない月は締められません']);
        expect(prisma.allowanceMonthClose.create).toHaveBeenCalledTimes(1);

        // 年をまたぐとき（日本時間 2027-01-01 0:00）も、前の月（12月）を締められる
        freezeNow('2026-12-31T15:00:00.000Z');
        const december = await closeMonth('2026-12');
        expect([december.status, december.body.ok]).toEqual([200, true]);
        expect((await closeMonth('2027-01')).body.error).toBe('まだ終わっていない月は締められません');
    });

    it('すでに締めてある月 → 400「この月は、すでに締めてあります」（締めた月の表を、その月で読む）', async () => {
        answer(prisma.allowanceMonthClose.findUnique, { month: MONTH });
        const r = await closeMonth();
        expect([r.status, r.body.error]).toEqual([400, 'この月は、すでに締めてあります']);
        expect(prisma.allowanceMonthClose.findUnique).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceMonthClose.findUnique)).toEqual({ where: { month: MONTH }, select: { month: true } });
        noWrites();
    });

    it('確認待ちが残っている月 → 400「確認待ちが2件あります。認めるか取り消してから締めてください」（件数入り）', async () => {
        answer(prisma.allowanceRecord.findMany, [...SEPTEMBER, row('foremanA', 'foreman', 1500, 'pending'), row('admin1', 'member', 200, 'pending')]);
        const two = await closeMonth();
        expect([two.status, two.body.error]).toEqual([400, '確認待ちが2件あります。認めるか取り消してから締めてください']);

        answer(prisma.allowanceRecord.findMany, [row('admin1', 'member', 200, 'pending')]);
        const one = await closeMonth();
        expect([one.status, one.body.error]).toEqual([400, '確認待ちが1件あります。認めるか取り消してから締めてください']);
        noWrites();
    });
});

describe("action: 'close'（締める）: 締められるとき", () => {
    it('締めた月の表に1行足す（month・締めた人の id と名前）。履歴に、締めた時点の件数・人数・金額を残す。応答は { ok, month, closed }', async () => {
        const r = await closeMonth();
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ ok: true, month: MONTH, closed: { closedByName: '管理者1', closedAt: '2026-10-01T00:30:00.000Z' } });
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');

        expect(prisma.allowanceMonthClose.create).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceMonthClose.create)).toEqual({
            data: { month: MONTH, closedBy: 'admin1', closedByName: '管理者1' },
            select: { closedAt: true },
        });

        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceLog.create)).toEqual({
            data: {
                action: 'month_closed', actorId: 'admin1', actorName: '管理者1', month: MONTH,
                // 5件・3人・職長として 2日・職長以外として 3日・合計 1,500 + 2,000 + 300 + 200 + 300 円
                detail: { records: 5, people: 3, foremanDays: 2, memberDays: 3, totalAmount: 4300 },
            },
        });
        expect(prisma.allowanceMonthClose.deleteMany).not.toHaveBeenCalled();
    });

    it('順番は「トランザクションを開く → 鍵を取る → 締めてあるかを読む → その月の記録を読む → 締めた月を書く → 履歴」', async () => {
        expect((await closeMonth()).status).toBe(200);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        // トランザクションの設定を渡す: 始められるまで待つのは 5秒まで・始めてから終わるまでは 10秒まで（鍵が空くのを待つ時間は、この 10秒に入る）
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 10000 });
        expect(lockSqls()).toEqual(["SELECT pg_advisory_xact_lock(hashtext('dandolink-allowance'))"]);
        const steps = [
            orderOf(prisma.$transaction),
            orderOf(prisma.$executeRaw),
            orderOf(prisma.allowanceMonthClose.findUnique),
            orderOf(prisma.allowanceRecord.findMany),
            orderOf(prisma.allowanceMonthClose.create),
            orderOf(prisma.allowanceLog.create),
        ];
        expect(steps.every((n) => typeof n === 'number')).toBe(true);
        expect(steps).toEqual([...steps].sort((a, b) => a - b));
    });

    it('確認待ちを数えるために読む記録は、その月の全部（月の1日 〜 翌月1日より前。UTC 0時の印。手当では絞らない）', async () => {
        expect((await closeMonth()).status).toBe(200);
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceRecord.findMany)).toEqual({
            where: { date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') } },
            select: { userId: true, payRole: true, amount: true, status: true },
        });

        // 12月（年をまたぐ月）
        expect((await closeMonth('2025-12')).status).toBe(200);
        expect(argsOf<{ where: unknown }>(prisma.allowanceRecord.findMany, 1).where).toEqual({ date: { gte: utc0('2025-12-01'), lt: utc0('2026-01-01') } });
        expect(argsOf(prisma.allowanceMonthClose.findUnique, 1)).toEqual({ where: { month: '2025-12' }, select: { month: true } });
        expect(argsOf<{ data: unknown }>(prisma.allowanceMonthClose.create, 1).data).toEqual({ month: '2025-12', closedBy: 'admin1', closedByName: '管理者1' });
    });

    it('記録が1件も無い月も締められる（履歴の数字は全部 0）', async () => {
        answer(prisma.allowanceRecord.findMany, []);
        const r = await closeMonth();
        expect([r.status, r.body.ok]).toEqual([200, true]);
        expect(prisma.allowanceMonthClose.create).toHaveBeenCalledTimes(1);
        expect(argsOf<{ data: { detail: unknown } }>(prisma.allowanceLog.create).data.detail)
            .toEqual({ records: 0, people: 0, foremanDays: 0, memberDays: 0, totalAmount: 0 });
    });

    it('年が 2000〜2999 の月は、形は正しい（2000-01 は締められる。2999-12 は「まだ終わっていない月」）', async () => {
        const oldest = await closeMonth('2000-01');
        expect([oldest.status, oldest.body.ok, oldest.body.month]).toEqual([200, true, '2000-01']);
        expect(argsOf<{ data: { month: string } }>(prisma.allowanceMonthClose.create).data.month).toBe('2000-01');
        expect(argsOf<{ where: unknown }>(prisma.allowanceRecord.findMany).where).toEqual({ date: { gte: utc0('2000-01-01'), lt: utc0('2000-02-01') } });

        const farFuture = await closeMonth('2999-12');
        expect([farFuture.status, farFuture.body.error]).toEqual([400, 'まだ終わっていない月は締められません']);
        expect(prisma.allowanceMonthClose.create).toHaveBeenCalledTimes(1);
    });

    it("status・payRole に知らない値が入っている記録は、確定・職長以外として数える（'pending' だけが確認待ち・'foreman' だけが職長）", async () => {
        answer(prisma.allowanceRecord.findMany, [row('worker1', 'FOREMAN', 1500, 'PENDING'), row('worker2', 'member', 200, '')]);
        const r = await closeMonth();
        expect([r.status, r.body.ok]).toEqual([200, true]);
        expect(argsOf<{ data: { detail: unknown } }>(prisma.allowanceLog.create).data.detail)
            .toEqual({ records: 2, people: 2, foremanDays: 0, memberDays: 2, totalAmount: 1700 });
    });
});

// ================================================================ reopen

describe("action: 'reopen'（締めを外す）", () => {
    it("month の形が違う・年が 2000〜2999 でない（'0026-09'・'1999-12'・'3000-01'）→ 400「月が不正です」。DB に触らない", async () => {
        for (const month of ['2026-13', '2026-00', '2026-9', '202609', '2026/09', '2026-09-01', ' 2026-09', '', '0026-09', '1999-12', '0000-01', '3000-01', '9999-12']) {
            const r = await reopenMonth(month);
            expect([month, r.status, r.body.error, r.body.details]).toEqual([month, 400, 'Validation Error', '月が不正です']);
        }
        noDbAccess();
    });

    it('年が 2000〜2999 の月は受け付ける（2000-01・2999-12 とも、送った月の行を消す）', async () => {
        for (const month of ['2000-01', '2999-12']) {
            mock(prisma.allowanceMonthClose.deleteMany).mockClear();
            const r = await reopenMonth(month);
            expect([month, r.status, r.body]).toEqual([month, 200, { ok: true, month, closed: null }]);
            expect(argsOf(prisma.allowanceMonthClose.deleteMany)).toEqual({ where: { month } });
        }
    });

    it('締めていない月（消えた行が 0）→ 400「この月は締めていません」。履歴は書かない', async () => {
        answer(prisma.allowanceMonthClose.deleteMany, { count: 0 });
        const r = await reopenMonth();
        expect([r.status, r.body.error]).toEqual([400, 'この月は締めていません']);
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    });

    it('締めた月の表から、その月の行を消す。履歴は month_reopened。応答は { ok: true, month, closed: null }', async () => {
        const r = await reopenMonth();
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ ok: true, month: MONTH, closed: null });
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');

        expect(prisma.allowanceMonthClose.deleteMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceMonthClose.deleteMany)).toEqual({ where: { month: MONTH } });
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceLog.create)).toEqual({
            data: { action: 'month_reopened', actorId: 'admin1', actorName: '管理者1', month: MONTH },
        });
        // 締めるほうの書き込みはしない
        expect(prisma.allowanceMonthClose.create).not.toHaveBeenCalled();
    });

    it('順番は「トランザクションを開く → 鍵を取る → 締めた月の行を消す → 履歴」', async () => {
        expect((await reopenMonth()).status).toBe(200);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        // トランザクションの設定を渡す: 始められるまで待つのは 5秒まで・始めてから終わるまでは 10秒まで（鍵が空くのを待つ時間は、この 10秒に入る）
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 10000 });
        expect(lockSqls()).toEqual(["SELECT pg_advisory_xact_lock(hashtext('dandolink-allowance'))"]);
        const steps = [
            orderOf(prisma.$transaction),
            orderOf(prisma.$executeRaw),
            orderOf(prisma.allowanceMonthClose.deleteMany),
            orderOf(prisma.allowanceLog.create),
        ];
        expect(steps.every((n) => typeof n === 'number')).toBe(true);
        expect(steps).toEqual([...steps].sort((a, b) => a - b));
    });
});

// ================================================================ 例外・設定

describe('例外・設定', () => {
    it("毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'）", () => {
        expect(dynamic).toBe('force-dynamic');
    });

    it('DB の読み書きで例外が起きたら 500（締める・締めを外す）。履歴は書かない', async () => {
        mock(prisma.allowanceMonthClose.findUnique).mockRejectedValue(new Error('DB に届かない'));
        expect((await closeMonth()).status).toBe(500);

        mock(prisma.allowanceMonthClose.deleteMany).mockRejectedValue(new Error('DB に届かない'));
        expect((await reopenMonth()).status).toBe(500);

        expect(prisma.allowanceMonthClose.create).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    });
});
