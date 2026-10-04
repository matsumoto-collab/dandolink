/**
 * @jest-environment node
 *
 * 手当の記録の API のテスト（docs/指示書_大規模手当.md の 6-3）。
 *   GET・POST・PATCH /api/allowances/records
 *   DELETE /api/allowances/records/[id]
 *
 * route は、lib/allowances.ts（決まりごと）・lib/allowancesServer.ts（鍵 → 締めの確かめ → 書く → 履歴）・
 * lib/allowancesReport.ts（一覧の1行の形）の関数を、本物のまま呼ぶ。
 * @/lib/prisma と @/lib/api/utils だけは、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * だから「絞り込みが正しいか」は、返ってきた値ではなく、findMany・findUnique・updateMany・deleteMany に渡した引数で確かめる。
 *
 * このファイルでは、次の4つだけ「渡された条件を見て答える」ようにしてある（beforeEach を参照）:
 *   人（USERS）・手当（ITEMS）・金額の履歴（RATES）・締めた月（closedMonths）
 * $transaction は jest.setup.ts と同じ動き（同じモックの prisma を渡して、すぐ実行する）のまま、
 * 「終わった印」（transactionEnd）だけを足してある（書き込みと履歴が、トランザクションの中で行われたかを確かめるため）。
 *
 * 日付: 「先の日付」には遠い先（2099年）、ほかは過去の日付（2026年7月〜9月）を使う。
 * 大規模手当の始まりの日（いちばん古い適用開始日）は 2026-08-01。それより前の日付（7月）には付けられない。
 * 「今日」を日本時間で決めているか・認めた日時を確かめるテストだけ、時計を固定する（freezeNow）。
 */
import { NextRequest, NextResponse } from 'next/server';
import * as recordsRoute from '@/app/api/allowances/records/route';
import * as recordByIdRoute from '@/app/api/allowances/records/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { ALLOWANCE_RECORD_SELECT } from '@/lib/allowancesReport';

const { GET, POST, PATCH } = recordsRoute;
const { DELETE } = recordByIdRoute;

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

// ---------------------------------------------------------------- ログインしている人

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER = { id: 'manager1', role: 'manager', name: 'マネージャー1' };

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

// ---------------------------------------------------------------- 呼び方と、応答の読み方

const jsonRequest = (path: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        // 文字列は、そのまま body にする（JSON として読めない body を送るため）
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

interface RecordBody {
    id: string; userId: string; userName: string; date: string; itemId: string; itemName: string; payRole: string; amount: number;
    status: string; source: string; note: string | null; createdBy: string; createdByName: string; createdAt: string;
    confirmedByName: string | null; confirmedAt: string | null; closed: boolean; canRemove: boolean; canConfirm: boolean;
}
interface Body { error?: string; details?: string; ok?: boolean; record?: RecordBody; records?: RecordBody[]; confirmed?: number; skipped?: number }
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Body, cache: res.headers.get('Cache-Control') });

const getRecords = (query: string) => GET(jsonRequest(`/api/allowances/records?${query}`, 'GET')).then(read);
const postRecord = (body: unknown) => POST(jsonRequest('/api/allowances/records', 'POST', body)).then(read);
const patchRecords = (body: unknown) => PATCH(jsonRequest('/api/allowances/records', 'PATCH', body)).then(read);
const deleteRecord = (id: string) => DELETE(jsonRequest(`/api/allowances/records/${id}`, 'DELETE'), { params: { id } }).then(read);

// ---------------------------------------------------------------- 断るときの文言・トランザクションの設定
// lib の定数は import せず、文字そのものを書く（定数を書きかえたら、このテストが落ちるように）

/** その日付に有効な金額が無い（手当が始まる前の日付・金額の行が1つも無い）とき（lib/allowances.ts の ALLOWANCE_NO_RATE_MESSAGE） */
const NO_RATE_MESSAGE = 'この日付には、この手当の金額が設定されていません（手当が始まる前の日付には付けられません）';
/** 締めた月の記録を、足す・取り消すとき（lib/allowances.ts の ALLOWANCE_CLOSED_MESSAGE） */
const CLOSED_MESSAGE = 'この月は締めてあります（管理者が締めを外すと、変えられます）';
/** 「使わない」にしてある手当を付けるとき（lib/allowances.ts の ALLOWANCE_INACTIVE_MESSAGE） */
const INACTIVE_MESSAGE = 'この手当は「使わない」になっています（管理者が、設定の「手当」で「使う」にすると、付けられます）';
/** メモが文字列でない・200字より長いとき */
const NOTE_MESSAGE = 'メモは200字までの文字で入れてください';
/** 管理者・マネージャーが、確定した自分の分を取り消そうとしたとき */
const OWN_RECORD_MESSAGE = '自分の分の記録は、自分では取り消せません（ほかの管理者・マネージャーに頼んでください）';
/** 記録を書くトランザクションに渡す設定（lib/allowancesServer.ts の ALLOWANCE_TX_OPTIONS）。鍵が空くのを待つ時間も入るので、Prisma の既定（5秒）より長い */
const TX_OPTIONS = { maxWait: 5000, timeout: 10000 };

/** 形のまちがい（validationErrorResponse）は、モックでは文言が details に入る。決まりで断るもの（errorResponse）は error に入る */
const messageOf = (r: { body: Body }) => r.body.details ?? r.body.error;

// ---------------------------------------------------------------- DB の中身（モックが返すもの）

/** 人（User）。role は DB の値のまま（大文字が混ざる） */
const USERS: Record<string, { id: string; displayName: string; role: string; isActive: boolean }> = {
    admin1: { id: 'admin1', displayName: '管理者1', role: 'ADMIN', isActive: true },
    manager1: { id: 'manager1', displayName: 'マネージャー1', role: 'MANAGER', isActive: true },
    foremanA: { id: 'foremanA', displayName: '職長A', role: 'FOREMAN1', isActive: true },
    foremanB: { id: 'foremanB', displayName: '職長B', role: 'foreman2', isActive: true },
    worker1: { id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: true },
    retired1: { id: 'retired1', displayName: '辞めた作業員', role: 'WORKER', isActive: false },
    partner1: { id: 'partner1', displayName: '協力会社', role: 'PARTNER', isActive: true },
    partnerMember1: { id: 'partnerMember1', displayName: '協力会社のメンバー', role: 'partner_member', isActive: true },
    accountant1: { id: 'accountant1', displayName: '税理士', role: 'ACCOUNTANT', isActive: true },
    support1: { id: 'support1', displayName: '応援', role: 'support', isActive: true },
};

/** 手当（AllowanceItem） */
const ITEMS: Record<string, { id: string; name: string; isActive: boolean }> = {
    large: { id: 'large', name: '大規模手当', isActive: true },
    old: { id: 'old', name: '遠方手当（旧）', isActive: false },
    norate: { id: 'norate', name: '金額がまだ無い手当', isActive: true },
};

/**
 * 金額の履歴（AllowanceRate）。大規模手当は 8/1 から「職長 1,000円・職長以外 100円」、9/1 から「職長 1,500円・職長以外 200円」。
 * いちばん古い適用開始日（8/1）が、この手当の始まりの日（それより前の日付には、有効な金額が無い）
 */
const RATES = [
    { id: 'rate1', itemId: 'large', foremanAmount: 1000, memberAmount: 100, effectiveFrom: utc0('2026-08-01'), createdAt: new Date('2026-08-01T01:00:00.000Z') },
    { id: 'rate2', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-08-20T01:00:00.000Z') },
];

/** 締めてある月（'YYYY-MM'）。テストごとに決める */
let closedMonths: string[] = [];

/** 記録の行（DB の全部の列）。既定は「職長A が、9/10 に、作業員1 へ付けた、確定の記録」 */
const recordRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1', userId: 'worker1', date: utc0('2026-09-10'), itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200,
    rateId: 'rate2', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null,
    createdBy: 'foremanA', createdByName: '職長A', confirmedBy: null, confirmedByName: null, confirmedAt: null,
    createdAt: new Date('2026-09-10T09:00:00.000Z'), updatedAt: new Date('2026-09-10T09:00:00.000Z'), ...over,
});
/** 職長A が、自分に付けた確認待ちの記録（職長として 1,500円） */
const pendingRow = (over: Record<string, unknown> = {}) =>
    recordRow({ userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'pending', ...over });

// ---------------------------------------------------------------- 確かめるための部品

/** 記録も履歴も、何も書いていないこと（鍵を取って、読むところまでは進んでいてもよい） */
const nothingWritten = () => {
    expect(prisma.allowanceRecord.create).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.createMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.update).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.upsert).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.delete).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.deleteMany).not.toHaveBeenCalled();
    expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
};
/** 保存の手前で断っていること（トランザクションを開いていない・鍵も取っていない・何も書いていない） */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    nothingWritten();
};
/** DB を何も読んでいないこと */
const noReads = () => {
    expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.findUnique).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.allowanceItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
};

/** 書かれた履歴の行（create でも createMany でも、1行ずつにして、書かれた順に返す） */
const writtenLogs = (): Record<string, unknown>[] => {
    const one = mock(prisma.allowanceLog.create).mock;
    const many = mock(prisma.allowanceLog.createMany).mock;
    return [
        ...one.calls.map((c, i) => ({ at: one.invocationCallOrder[i], rows: [(c[0] as { data: Record<string, unknown> }).data] })),
        ...many.calls.map((c, i) => ({ at: many.invocationCallOrder[i], rows: (c[0] as { data: Record<string, unknown>[] }).data })),
    ].sort((a, b) => a.at - b.at).flatMap((x) => x.rows);
};
/** createManyAndReturn に渡した引数（1回目の呼び出し） */
const insertArgs = () => mock(prisma.allowanceRecord.createManyAndReturn).mock.calls[0][0] as { data: Record<string, unknown>[]; skipDuplicates?: boolean };
/** 締めの表に問い合わせた月（呼び出しごと。月の並びは問わないので、並べ替えて返す） */
const monthsAsked = (): string[][] =>
    mock(prisma.allowanceMonthClose.findMany).mock.calls.map((c) => [...(c[0] as { where: { month: { in: string[] } } }).where.month.in].sort());
/** 鍵を取るときに実行した SQL（1回目の呼び出し） */
const lockSql = () => String(mock(prisma.$executeRaw).mock.calls[0][0]);
/** $transaction の2つめの引数（1回目の呼び出し） */
const transactionOptions = (): unknown => mock(prisma.$transaction).mock.calls[0][1];

/** トランザクションが終わった印。$transaction に渡された関数が終わったときに呼ばれる（beforeEach を参照） */
const transactionEnd = jest.fn();

/** そのモックたちが、最初に呼ばれたのは通しで何番目か。1回も呼ばれていなければ Infinity */
const firstCall = (...fns: unknown[]) => Math.min(...fns.flatMap((fn) => mock(fn).mock.invocationCallOrder));
/** 名前を付けた手順が、全部呼ばれていて、書いた順に始まっていること */
const expectOrder = (steps: [string, number][]) => {
    expect(steps.filter(([, at]) => at === Infinity).map(([name]) => `${name}（呼ばれていない）`)).toEqual([]);
    expect([...steps].sort((a, b) => a[1] - b[1]).map(([name]) => name)).toEqual(steps.map(([name]) => name));
};

/** 記録の ID → { 締めた月か・取り消せるか・認められるか } */
const flagsById = (records: RecordBody[] | undefined) =>
    Object.fromEntries((records ?? []).map((x) => [x.id, { closed: x.closed, canRemove: x.canRemove, canConfirm: x.canConfirm }]));

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(ADMIN);
    closedMonths = [];

    // $transaction は、jest.setup.ts と同じく「同じモックの prisma を渡して、すぐ実行する」。
    // 渡された関数が終わったら印を付ける（鍵・締めの確かめ・書き込み・履歴が、トランザクションの中で行われたかを確かめるため）
    mock(prisma.$transaction).mockImplementation(async (run: (tx: typeof prisma) => Promise<unknown>) => {
        try {
            return await run(prisma);
        } finally {
            transactionEnd();
        }
    });

    // 人・手当・金額・締めた月は、渡された条件に合うものだけを返す
    mock(prisma.user.findUnique).mockImplementation(async ({ where }: { where: { id: string } }) => USERS[where.id] ?? null);
    mock(prisma.user.findMany).mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => USERS[id] !== undefined).map((id) => ({ id, displayName: USERS[id].displayName })));
    mock(prisma.allowanceItem.findUnique).mockImplementation(async ({ where }: { where: { id: string } }) => ITEMS[where.id] ?? null);
    mock(prisma.allowanceRate.findMany).mockImplementation(async ({ where }: { where: { itemId: { in: string[] } } }) =>
        RATES.filter((r) => where.itemId.in.includes(r.itemId)));
    mock(prisma.allowanceMonthClose.findMany).mockImplementation(async ({ where }: { where: { month: { in: string[] } } }) =>
        closedMonths.filter((m) => where.month.in.includes(m)).map((month) => ({ month })));

    // 記録は where を見ない。テストごとに「DB が絞ったあとの結果」を決めて返す
    mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);
    mock(prisma.allowanceRecord.findUnique).mockResolvedValue(null);
    // createManyAndReturn は「入った行の配列（全部の列）」を返すようにする
    mock(prisma.allowanceRecord.createManyAndReturn).mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) =>
        data.map((d, i) => ({
            id: `new-${i + 1}`, confirmedBy: null, confirmedByName: null, confirmedAt: null,
            createdAt: new Date('2026-10-02T03:00:00.000Z'), updatedAt: new Date('2026-10-02T03:00:00.000Z'), ...d,
        })));
    // updateMany・deleteMany は { count } を返すようにする（jest.fn() のままだと undefined が返り、route が 500 になる）。
    // 認める updateMany は「まとめて1回」なので、渡された ID の記録が全部変わった（count = ID の数）と答える
    mock(prisma.allowanceRecord.updateMany).mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length }));
    mock(prisma.allowanceRecord.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.allowanceLog.create).mockResolvedValue({});
    mock(prisma.allowanceLog.createMany).mockResolvedValue({ count: 1 });
});

afterEach(() => {
    jest.useRealTimers();
});

// ================================================================ 権限

describe('権限: admin・manager だけ（GET・POST・PATCH・DELETE の全部）', () => {
    /** 4つの操作を、管理者・マネージャーなら通る入力で、1回ずつ呼ぶ */
    const callAll = async () => [
        await getRecords('month=2026-09'),
        await postRecord({ userId: 'worker1', date: '2026-09-10', itemId: 'large', payRole: 'member' }),
        await patchRecords({ action: 'confirm', ids: ['p1'] }),
        await deleteRecord('r1'),
    ];

    beforeEach(() => {
        // 断られた理由が権限だけになるように、記録がある状態にしておく
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([pendingRow({ id: 'p1' })]);
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(recordRow({ id: 'r1' }));
    });

    it('ログインしていなければ、どの操作も 401。何も読まず、何も書かない', async () => {
        // 応答の本文は1回しか読めないので、呼ばれるたびに新しい応答を作る
        mock(requireAuth).mockImplementation(async () => ({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }));
        expect((await callAll()).map((r) => r.status)).toEqual([401, 401, 401, 401]);
        noReads();
        noWrites();
    });

    it.each([
        { id: 'foremanA', role: 'foreman1', name: '職長A' },   // p1 を付けた本人・r1 を付けた本人でも、この API は使えない
        { id: 'foremanB', role: 'foreman2', name: '職長B' },
        { id: 'worker1', role: 'worker', name: '作業員1' },     // r1 をもらった本人でも
        { id: 'partner1', role: 'partner', name: '協力会社' },
        { id: 'partnerMember1', role: 'partner_member', name: '協力会社のメンバー' },
        { id: 'accountant1', role: 'accountant', name: '税理士' },
        { id: 'support1', role: 'support', name: '応援' },
    ])('$role は、どの操作も 403「権限がありません」。何も読まず、何も書かない', async (user) => {
        loginAs(user);
        expect((await callAll()).map((r) => [r.status, r.body.error])).toEqual([
            [403, '権限がありません'], [403, '権限がありません'], [403, '権限がありません'], [403, '権限がありません'],
        ]);
        noReads();
        noWrites();
    });

    it('ロールの入っていないセッションも 403（id が管理者のものでも、ロールで決める）', async () => {
        mock(requireAuth).mockResolvedValue({ session: { user: { id: 'admin1', name: '管理者1' } }, error: null });
        expect((await callAll()).map((r) => r.status)).toEqual([403, 403, 403, 403]);
        noReads();
        noWrites();
    });

    it('管理者・マネージャーは、4つとも使える（一覧・付ける・認める・取り消す）。操作した人として、その人が残る', async () => {
        for (const user of [ADMIN, MANAGER]) {
            jest.clearAllMocks();
            loginAs(user);
            const [list, added, confirmed, removed] = await callAll();
            expect([user.role, list.status, added.status, confirmed.status, removed.status]).toEqual([user.role, 200, 201, 200, 200]);
            expect(confirmed.body).toEqual({ confirmed: 1, skipped: 0 });
            expect(removed.body).toEqual({ ok: true });

            expect(insertArgs().data[0]).toMatchObject({ createdBy: user.id, createdByName: user.name });
            expect(mock(prisma.allowanceRecord.updateMany).mock.calls[0][0].data).toMatchObject({ confirmedBy: user.id, confirmedByName: user.name });
            expect(writtenLogs().map((l) => [l.action, l.actorId, l.actorName])).toEqual([
                ['record_added', user.id, user.name],
                ['record_confirmed', user.id, user.name],
                ['record_removed', user.id, user.name],
            ]);
        }
    });
});

// ================================================================ GET

describe('GET /records: 入力の確かめ（合わなければ 400。DB は読まない）', () => {
    it('month が無ければ 400「入力が不正です」。status=pending のときだけ省ける', async () => {
        for (const q of ['', 'status=confirmed', 'userId=worker1', 'userId=worker1&status=confirmed']) {
            const r = await getRecords(q);
            expect([q, r.status, r.body.error, r.body.details]).toEqual([q, 400, 'Validation Error', '入力が不正です']);
        }
        noReads();

        expect((await getRecords('status=pending')).status).toBe(200);
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
    });

    it('month の形が違えば 400「月が不正です」（年は 2000〜2999・月は 01〜12。status=pending でも、month を書いたなら形を見る）', async () => {
        // '0026-09' のような年は、Date が 1926年と読んでしまうので受け付けない
        for (const month of ['2026-13', '2026-00', '2026-9', '2026/09', '202609', '2026-09-01', '', 'x', '0026-09', '0000-01', '1999-12', '3000-01']) {
            for (const q of [`month=${month}`, `month=${month}&status=pending`, `month=${month}&userId=worker1`]) {
                const r = await getRecords(q);
                expect([q, r.status, r.body.error, r.body.details]).toEqual([q, 400, 'Validation Error', '月が不正です']);
            }
        }
        noReads();
    });

    it('status は confirmed・pending だけ。userId の空文字も 400「入力が不正です」', async () => {
        for (const q of ['month=2026-09&status=all', 'month=2026-09&status=', 'month=2026-09&status=PENDING', 'month=2026-09&userId=', 'status=pending&userId=']) {
            const r = await getRecords(q);
            expect([q, r.status, r.body.error, r.body.details]).toEqual([q, 400, 'Validation Error', '入力が不正です']);
        }
        noReads();
    });
});

describe('GET /records: 絞り込み（モックは where を見ないので、渡した引数で確かめる）', () => {
    /** その問い合わせで、記録の findMany に渡した引数 */
    const findArgsOf = async (query: string) => {
        mock(prisma.allowanceRecord.findMany).mockClear();
        expect((await getRecords(query)).status).toBe(200);
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        return mock(prisma.allowanceRecord.findMany).mock.calls[0][0] as { where: unknown; orderBy: unknown; select: unknown };
    };
    const SEPTEMBER = { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') };

    it('月の範囲は「その月の1日（UTC 0時）から、翌月の1日より前」', async () => {
        expect((await findArgsOf('month=2026-09')).where).toEqual({ date: SEPTEMBER });
        // 年をまたぐ月・うるう年の2月
        expect((await findArgsOf('month=2026-12')).where).toEqual({ date: { gte: utc0('2026-12-01'), lt: utc0('2027-01-01') } });
        expect((await findArgsOf('month=2028-02')).where).toEqual({ date: { gte: utc0('2028-02-01'), lt: utc0('2028-03-01') } });
        // 受け付ける年の端（2000年1月・2999年12月）
        expect((await findArgsOf('month=2000-01')).where).toEqual({ date: { gte: utc0('2000-01-01'), lt: utc0('2000-02-01') } });
        expect((await findArgsOf('month=2999-12')).where).toEqual({ date: { gte: utc0('2999-12-01'), lt: utc0('3000-01-01') } });
    });

    it('userId・status は、指定されたものだけが where に入る', async () => {
        expect((await findArgsOf('month=2026-09&userId=worker1')).where).toEqual({ date: SEPTEMBER, userId: 'worker1' });
        expect((await findArgsOf('month=2026-09&status=confirmed')).where).toEqual({ date: SEPTEMBER, status: 'confirmed' });
        expect((await findArgsOf('month=2026-09&status=pending')).where).toEqual({ date: SEPTEMBER, status: 'pending' });
        expect((await findArgsOf('month=2026-09&userId=worker1&status=pending')).where).toEqual({ date: SEPTEMBER, userId: 'worker1', status: 'pending' });
    });

    it('status=pending で month を省くと、where に日付が無い（全部の月の確認待ち）', async () => {
        expect((await findArgsOf('status=pending')).where).toEqual({ status: 'pending' });
        expect((await findArgsOf('status=pending&userId=worker1')).where).toEqual({ userId: 'worker1', status: 'pending' });
    });

    it('並びは「日付の新しい順 → 付けた日時の新しい順」。読む列は ALLOWANCE_RECORD_SELECT（一覧の1行に要る列の全部）', async () => {
        for (const q of ['month=2026-09', 'status=pending']) {
            const args = await findArgsOf(q);
            expect(args.orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
            expect(args.select).toEqual(ALLOWANCE_RECORD_SELECT);
            expect(args.select).toEqual({
                id: true, userId: true, date: true, itemId: true, itemName: true, payRole: true, amount: true, status: true, source: true, note: true,
                createdBy: true, createdByName: true, createdAt: true, confirmedByName: true, confirmedAt: true,
            });
        }
    });
});

describe('GET /records: 応答', () => {
    it('1行の形（全部の項目）。日付は YYYY-MM-DD・日時は ISO の文字。並びは DB が返した順のまま。Cache-Control は no-store', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            // 職長A が自分に付けて、マネージャーが認めた記録
            recordRow({
                id: 'r2', userId: 'foremanA', date: utc0('2026-09-11'), payRole: 'foreman', amount: 1500,
                createdAt: new Date('2026-09-11T09:30:00.000Z'), updatedAt: new Date('2026-09-12T01:00:00.000Z'),
                confirmedBy: 'manager1', confirmedByName: 'マネージャー1', confirmedAt: new Date('2026-09-12T01:00:00.000Z'),
            }),
            // 管理者が「記録を足す」で作業員1 に付けた記録（メモつき）。
            // 記録に入っている名前・金額が、今の手当の表（「大規模手当」）・金額の表（職長以外 200円）と違っている
            recordRow({
                id: 'r1', itemName: '大規模現場の手当', amount: 150, rateId: 'rate0',
                source: 'manual', foremanId: null, note: '押し忘れの分', createdBy: 'admin1', createdByName: '管理者1',
            }),
        ]);
        const r = await getRecords('month=2026-09');
        expect([r.status, r.cache]).toEqual([200, 'no-store']);
        expect(r.body).toEqual({
            records: [
                {
                    id: 'r2', userId: 'foremanA', userName: '職長A', date: '2026-09-11', itemId: 'large', itemName: '大規模手当',
                    payRole: 'foreman', amount: 1500, status: 'confirmed', source: 'attendance', note: null,
                    createdBy: 'foremanA', createdByName: '職長A', createdAt: '2026-09-11T09:30:00.000Z',
                    confirmedByName: 'マネージャー1', confirmedAt: '2026-09-12T01:00:00.000Z',
                    closed: false, canRemove: true, canConfirm: false,
                },
                {
                    // 手当の名前・金額は、記録に入っているものをそのまま返す（一覧を作るときに、手当の表・金額の表から引き直さない）
                    id: 'r1', userId: 'worker1', userName: '作業員1', date: '2026-09-10', itemId: 'large', itemName: '大規模現場の手当',
                    payRole: 'member', amount: 150, status: 'confirmed', source: 'manual', note: '押し忘れの分',
                    createdBy: 'admin1', createdByName: '管理者1', createdAt: '2026-09-10T09:00:00.000Z',
                    confirmedByName: null, confirmedAt: null,
                    closed: false, canRemove: true, canConfirm: false,
                },
            ],
        });
        // 読むだけ（トランザクションも鍵も使わない・何も書かない）
        noWrites();
    });

    it('記録が1件も無ければ { records: [] }', async () => {
        const r = await getRecords('month=2026-09');
        expect([r.status, r.body, r.cache]).toEqual([200, { records: [] }, 'no-store']);
    });

    it('名前は、在籍（isActive）で絞らずに引く（辞めた人の記録にも名前を出す）。User の行が無い人は「（不明）」', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            recordRow({ id: 'a', userId: 'retired1' }),
            recordRow({ id: 'b', userId: 'ghost' }),
            recordRow({ id: 'c', userId: 'retired1', date: utc0('2026-09-09') }),
        ]);
        const r = await getRecords('month=2026-09');
        expect(r.body.records?.map((x) => [x.id, x.userName])).toEqual([['a', '辞めた作業員'], ['b', '（不明）'], ['c', '辞めた作業員']]);

        // 名前は、出てきた人の ID だけで引く（同じ人は1回だけ。在籍などの条件は足さない）
        expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        const args = mock(prisma.user.findMany).mock.calls[0][0] as { where: { id: { in: string[] } }; select: unknown };
        expect(Object.keys(args.where)).toEqual(['id']);
        expect(Object.keys(args.where.id)).toEqual(['in']);
        expect([...args.where.id.in].sort()).toEqual(['ghost', 'retired1']);
        expect(args.select).toMatchObject({ id: true, displayName: true });
    });

    it('DB の文字列は、決まった値にそろえて返す（知らない status は確定・知らない payRole は職長以外）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            recordRow({ id: 'a', status: 'PENDING', payRole: 'FOREMAN' }),
            recordRow({ id: 'b', status: '', payRole: 'leader' }),
            pendingRow({ id: 'c' }),
        ]);
        const r = await getRecords('month=2026-09');
        expect(r.body.records?.map((x) => [x.id, x.status, x.payRole])).toEqual([
            ['a', 'confirmed', 'member'], ['b', 'confirmed', 'member'], ['c', 'pending', 'foreman'],
        ]);
    });
});

describe('GET /records: 締めた月か・取り消せるか・認められるか', () => {
    it('締めた月の記録は closed: true で、canRemove・canConfirm が false（月を省いた確認待ちの一覧でも、記録の日付の月で見る）', async () => {
        closedMonths = ['2026-08'];
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            pendingRow({ id: 'sep-pending' }),
            pendingRow({ id: 'aug-pending', date: utc0('2026-08-31') }),
            pendingRow({ id: 'aug-pending-2', date: utc0('2026-08-01') }),
        ]);
        const pending = await getRecords('status=pending');
        expect(flagsById(pending.body.records)).toEqual({
            'sep-pending': { closed: false, canRemove: true, canConfirm: true },
            'aug-pending': { closed: true, canRemove: false, canConfirm: false },
            'aug-pending-2': { closed: true, canRemove: false, canConfirm: false },
        });
        // 締めの表には、出てきた記録の月だけを、1回で問い合わせる（同じ月は1回だけ）
        expect(monthsAsked()).toEqual([['2026-08', '2026-09']]);
        expect(mock(prisma.allowanceMonthClose.findMany).mock.calls[0][0].select).toEqual({ month: true });
    });

    it('締めた月を指定した一覧: 管理者でも、ほかの人の確定の記録を取り消せない', async () => {
        closedMonths = ['2026-08'];
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([recordRow({ id: 'aug-confirmed', date: utc0('2026-08-20') })]);
        const closed = await getRecords('month=2026-08');
        expect(flagsById(closed.body.records)).toEqual({ 'aug-confirmed': { closed: true, canRemove: false, canConfirm: false } });

        // 締めを外すと、取り消せるようになる
        closedMonths = [];
        const reopened = await getRecords('month=2026-08');
        expect(flagsById(reopened.body.records)).toEqual({ 'aug-confirmed': { closed: false, canRemove: true, canConfirm: false } });
    });

    it('締めていない月は、操作している人で変わる（自分の分は認められない・確定した自分の分は取り消せない）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            pendingRow({ id: 'foreman-pending' }),                                                                            // 職長A が自分に付けた確認待ち
            pendingRow({ id: 'admin-pending', userId: 'admin1', createdBy: 'admin1', createdByName: '管理者1' }),              // 管理者が自分に付けた確認待ち
            recordRow({ id: 'admin-confirmed', userId: 'admin1', createdBy: 'manager1', createdByName: 'マネージャー1' }),     // マネージャーが管理者に付けた分（確定）
            recordRow({ id: 'worker-confirmed' }),                                                                            // 職長A が作業員1 に付けた分（確定）
        ]);

        const asAdmin = await getRecords('month=2026-09');
        expect(flagsById(asAdmin.body.records)).toEqual({
            'foreman-pending': { closed: false, canRemove: true, canConfirm: true },    // ほかの人の確認待ち → 両方できる
            'admin-pending': { closed: false, canRemove: true, canConfirm: false },     // 自分の確認待ち → 取り下げだけ
            'admin-confirmed': { closed: false, canRemove: false, canConfirm: false },  // 自分の確定 → どちらもできない
            'worker-confirmed': { closed: false, canRemove: true, canConfirm: false },  // ほかの人の確定 → 取り消しだけ
        });

        loginAs(MANAGER);
        const asManager = await getRecords('month=2026-09');
        expect(flagsById(asManager.body.records)).toEqual({
            'foreman-pending': { closed: false, canRemove: true, canConfirm: true },
            'admin-pending': { closed: false, canRemove: true, canConfirm: true },      // マネージャーから見れば、ほかの人の確認待ち
            'admin-confirmed': { closed: false, canRemove: true, canConfirm: false },
            'worker-confirmed': { closed: false, canRemove: true, canConfirm: false },
        });
    });

    it('一覧の canRemove・canConfirm は、実際に取り消せるか・認められるかと食い違わない（管理者でも、マネージャーでも）', async () => {
        closedMonths = ['2026-08'];
        const cases = [
            { id: 'foreman-pending', month: '2026-09', row: pendingRow({ id: 'foreman-pending' }) },
            { id: 'admin-pending', month: '2026-09', row: pendingRow({ id: 'admin-pending', userId: 'admin1', createdBy: 'admin1' }) },
            { id: 'manager-pending', month: '2026-09', row: pendingRow({ id: 'manager-pending', userId: 'manager1', createdBy: 'manager1' }) },
            { id: 'admin-confirmed', month: '2026-09', row: recordRow({ id: 'admin-confirmed', userId: 'admin1', createdBy: 'manager1' }) },
            { id: 'manager-confirmed', month: '2026-09', row: recordRow({ id: 'manager-confirmed', userId: 'manager1', createdBy: 'admin1' }) },
            { id: 'worker-confirmed', month: '2026-09', row: recordRow({ id: 'worker-confirmed' }) },
            { id: 'closed-pending', month: '2026-08', row: pendingRow({ id: 'closed-pending', date: utc0('2026-08-31') }) },
            { id: 'closed-confirmed', month: '2026-08', row: recordRow({ id: 'closed-confirmed', date: utc0('2026-08-31') }) },
        ];
        for (const user of [ADMIN, MANAGER]) {
            loginAs(user);
            for (const { id, month, row } of cases) {
                // 一覧では、どう見えるか
                mock(prisma.allowanceRecord.findMany).mockResolvedValue([row]);
                const listed = (await getRecords(`month=${month}`)).body.records?.[0];
                // 実際に、取り消してみる・認めてみる
                mock(prisma.allowanceRecord.findUnique).mockResolvedValue(row);
                const removed = (await deleteRecord(id)).status === 200;
                const confirmed = (await patchRecords({ action: 'confirm', ids: [id] })).body.confirmed === 1;
                expect({ who: user.role, id, canRemove: listed?.canRemove, canConfirm: listed?.canConfirm })
                    .toEqual({ who: user.role, id, canRemove: removed, canConfirm: confirmed });
            }
        }
    });
});

// ================================================================ POST

describe('POST /records', () => {
    const body = (over: Record<string, unknown> = {}) => ({ userId: 'worker1', date: '2026-09-10', itemId: 'large', payRole: 'member', ...over });
    /** その内容で付けて（201）、createManyAndReturn に渡した1件を返す */
    const dataOf = async (over: Record<string, unknown> = {}) => {
        mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
        const r = await postRecord(body(over));
        expect([JSON.stringify(over), r.status]).toEqual([JSON.stringify(over), 201]);
        expect(insertArgs().data).toHaveLength(1);
        return insertArgs().data[0];
    };

    describe('確かめる順番（合わなければ、その時点で断る。何も書かない）', () => {
        it('入力の形が違う → 400「入力が不正です」（JSON として読めない body・配列も 400。500 にしない）。メモは 400「メモは200字までの文字で入れてください」', async () => {
            const cases: [string, Record<string, unknown>][] = [
                ['userId が無い', { userId: undefined }],
                ['userId が空', { userId: '' }],
                ['userId が文字列でない', { userId: 1 }],
                ['userId が null', { userId: null }],
                ['itemId が無い', { itemId: undefined }],
                ['itemId が空', { itemId: '' }],
                ['itemId が文字列でない', { itemId: 1 }],
                ['date が無い', { date: undefined }],
                ['date が文字列でない', { date: 20260910 }],
                ['payRole が無い', { payRole: undefined }],
                ['payRole が決まった2つ以外', { payRole: 'leader' }],
                ['payRole が大文字', { payRole: 'FOREMAN' }],
                ['payRole が空', { payRole: '' }],
                ['payRole が null', { payRole: null }],
                ['payRole が文字列でない', { payRole: true }],
            ];
            for (const [label, over] of cases) {
                const r = await postRecord(body(over));
                expect([label, r.status, r.body.error, r.body.details]).toEqual([label, 400, 'Validation Error', '入力が不正です']);
            }
            // メモだけは、何を直せばよいかが分かる文言で断る
            const noteCases: [string, unknown][] = [
                ['note が数', 5],
                ['note が真偽値', true],
                ['note が配列', ['メモ']],
                ['note がオブジェクト', { text: 'メモ' }],
                ['note が 201字', 'あ'.repeat(201)],
                ['note が、空白を取っても 201字', `  ${'あ'.repeat(201)}  `],
            ];
            for (const [label, note] of noteCases) {
                const r = await postRecord(body({ note }));
                expect([label, r.status, r.body.error, r.body.details]).toEqual([label, 400, 'Validation Error', NOTE_MESSAGE]);
            }
            for (const raw of ['これは JSON ではない', '"文字列"', '5', 'null', '[]', `[${JSON.stringify(body())}]`]) {
                const r = await postRecord(raw);
                expect([raw, r.status, r.body.error, r.body.details]).toEqual([raw, 400, 'Validation Error', '入力が不正です']);
            }
            noReads();
            noWrites();
        });

        it('日付の形が違う → 400「日付が不正です」／先の日付 → 400「先の日付には付けられません」', async () => {
            for (const date of ['2026-02-30', '2026-13-01', '2026/09/10', '2026-9-10', '20260910', '']) {
                const r = await postRecord(body({ date }));
                expect([date, r.status, r.body.error, r.body.details]).toEqual([date, 400, 'Validation Error', '日付が不正です']);
            }
            for (const date of ['2099-01-01', '2099-12-31']) {
                const r = await postRecord(body({ date }));
                expect([date, r.status, r.body.error]).toEqual([date, 400, '先の日付には付けられません']);
            }
            noReads();
            noWrites();
        });

        it('「今日」は日本時間で決まる（UTC ではまだ前日でも、日本の日付が今日なら付けられる）', async () => {
            freezeNow('2026-10-31T15:30:00.000Z'); // 日本時間 11/1 0:30（UTC では 10/31）
            expect((await postRecord(body({ date: '2026-11-01' }))).status).toBe(201);
            expect(messageOf(await postRecord(body({ date: '2026-11-02' })))).toBe('先の日付には付けられません');

            freezeNow('2026-10-31T14:59:00.000Z'); // 日本時間 10/31 23:59
            expect(messageOf(await postRecord(body({ date: '2026-11-01' })))).toBe('先の日付には付けられません');
            expect((await postRecord(body({ date: '2026-10-31' }))).status).toBe(201);
        });

        it('対象の人が無い → 400「対象の人が見つかりません」', async () => {
            const r = await postRecord(body({ userId: 'ghost' }));
            expect([r.status, r.body.error]).toEqual([400, '対象の人が見つかりません']);
            expect(mock(prisma.user.findUnique).mock.calls.map((c) => c[0].where)).toEqual([{ id: 'ghost' }]);
            expect(prisma.allowanceItem.findUnique).not.toHaveBeenCalled();
            noWrites();
        });

        it('手当をもらえないロールの人（協力会社・協力会社のメンバー・税理士・応援）→ 400「手当の対象外の人です」。DB のロールが大文字でも', async () => {
            for (const userId of ['partner1', 'partnerMember1', 'accountant1', 'support1']) {
                const r = await postRecord(body({ userId }));
                expect([userId, USERS[userId].role, r.status, r.body.error]).toEqual([userId, USERS[userId].role, 400, '手当の対象外の人です']);
            }
            noWrites();
        });

        it('手当をもらえるロール（作業員・職長・マネージャー・管理者）なら、DB のロールが大文字でも付けられる', async () => {
            for (const userId of ['worker1', 'foremanA', 'foremanB', 'manager1', 'admin1']) {
                expect(await dataOf({ userId })).toMatchObject({ userId });
            }
        });

        it('辞めた人（isActive: false）にも付けられる（在籍は見ない＝辞めた人の、在籍中の日の分も付けられる）', async () => {
            const r = await postRecord(body({ userId: 'retired1' }));
            expect(r.status).toBe(201);
            expect(r.body.record).toMatchObject({ userId: 'retired1', userName: '辞めた作業員', status: 'confirmed' });
            expect(insertArgs().data[0]).toMatchObject({ userId: 'retired1' });
            // 人は ID だけで引く（在籍で絞らない・在籍の列も読まない）
            expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
            const args = mock(prisma.user.findUnique).mock.calls[0][0] as { where: unknown; select: Record<string, unknown> };
            expect(args.where).toEqual({ id: 'retired1' });
            expect(args.select).toMatchObject({ displayName: true, role: true });
            expect(args.select).not.toHaveProperty('isActive');
        });

        it('手当が無い → 404「手当が見つかりません」／「使わない」にしてある手当 → 400「この手当は「使わない」になっています（管理者が、設定の「手当」で「使う」にすると、付けられます）」', async () => {
            const none = await postRecord(body({ itemId: 'ghost' }));
            expect([none.status, none.body.error]).toEqual([404, '手当が見つかりません']);

            const inactive = await postRecord(body({ itemId: 'old' }));
            expect([inactive.status, inactive.body.error]).toEqual([400, INACTIVE_MESSAGE]);

            // 手当は ID で引く
            expect(mock(prisma.allowanceItem.findUnique).mock.calls.map((c) => c[0].where)).toEqual([{ id: 'ghost' }, { id: 'old' }]);
            noWrites();
        });

        it('いくつも合わないときは、先に確かめるものの文言で断る（入力の形 → メモ → 日付の形 → 先の日付 → 対象の人 → 手当が無い → 使わない手当）', async () => {
            const results = [
                await postRecord(body({ payRole: 'x', note: 5, date: '2026-02-30', userId: 'ghost', itemId: 'ghost' })),
                await postRecord(body({ note: 5, date: '2026-02-30', userId: 'ghost', itemId: 'ghost' })),
                await postRecord(body({ date: '2099-02-30', userId: 'ghost', itemId: 'ghost' })),   // 先の年でも、形のまちがいが先
                await postRecord(body({ date: '2099-01-01', userId: 'ghost', itemId: 'ghost' })),
                await postRecord(body({ userId: 'ghost', itemId: 'ghost' })),
                await postRecord(body({ userId: 'partner1', itemId: 'ghost' })),
                await postRecord(body({ itemId: 'ghost' })),
                await postRecord(body({ itemId: 'old', date: '2026-07-31' })),                     // 使わない手当は、締め・金額より先に断る（保存の手前）
            ];
            expect(results.map((r) => [r.status, messageOf(r)])).toEqual([
                [400, '入力が不正です'],
                [400, NOTE_MESSAGE],
                [400, '日付が不正です'],
                [400, '先の日付には付けられません'],
                [400, '対象の人が見つかりません'],
                [400, '手当の対象外の人です'],
                [404, '手当が見つかりません'],
                [400, INACTIVE_MESSAGE],
            ]);
            noWrites();
        });
    });

    describe('保存', () => {
        it('他の人に付けると確定。source は manual・foremanId は null。履歴は1行。応答は 201 と、一覧と同じ形の record（closed: false）', async () => {
            const r = await postRecord(body({ note: '  押し忘れの分  ' }));
            expect([r.status, r.cache]).toEqual([201, 'no-store']);

            expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
            expect(insertArgs()).toEqual({
                data: [{
                    userId: 'worker1', date: utc0('2026-09-10'), itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, rateId: 'rate2',
                    status: 'confirmed', source: 'manual', foremanId: null, note: '押し忘れの分',
                    createdBy: 'admin1', createdByName: '管理者1',
                }],
                skipDuplicates: true,
            });
            expect(writtenLogs()).toEqual([{
                action: 'record_added', actorId: 'admin1', actorName: '管理者1', targetUserId: 'worker1', itemId: 'large', recordId: 'new-1',
                recordDate: utc0('2026-09-10'),
                detail: { itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed', source: 'manual' },
            }]);
            expect(r.body).toEqual({
                record: {
                    id: 'new-1', userId: 'worker1', userName: '作業員1', date: '2026-09-10', itemId: 'large', itemName: '大規模手当',
                    payRole: 'member', amount: 200, status: 'confirmed', source: 'manual', note: '押し忘れの分',
                    createdBy: 'admin1', createdByName: '管理者1', createdAt: '2026-10-02T03:00:00.000Z',
                    confirmedByName: null, confirmedAt: null,
                    closed: false, canRemove: true, canConfirm: false,
                },
            });
        });

        it('自分に付けると確認待ち（status: pending）。自分では認められない・取り下げはできる', async () => {
            const r = await postRecord(body({ userId: 'admin1', payRole: 'foreman' }));
            expect(r.status).toBe(201);
            expect(insertArgs().data[0]).toMatchObject({ userId: 'admin1', status: 'pending', payRole: 'foreman', amount: 1500, createdBy: 'admin1' });
            expect(r.body.record).toMatchObject({ userId: 'admin1', userName: '管理者1', status: 'pending', closed: false, canRemove: true, canConfirm: false });
            expect(writtenLogs()[0].detail).toMatchObject({ status: 'pending' });

            // マネージャーが自分に付けても同じ
            loginAs(MANAGER);
            expect(await dataOf({ userId: 'manager1' })).toMatchObject({ userId: 'manager1', status: 'pending', createdBy: 'manager1' });
            // マネージャーが管理者に付けたら確定（自分の分でないから）
            expect(await dataOf({ userId: 'admin1' })).toMatchObject({ userId: 'admin1', status: 'confirmed', createdBy: 'manager1' });
        });

        it('金額は「記録の日付に有効な金額」の、職長／職長以外のほう（保存した日ではなく、現場に入った日で決める）', async () => {
            // 9/1 から: 職長 1,500円・職長以外 200円
            expect(await dataOf({ date: '2026-09-01', payRole: 'foreman' })).toMatchObject({ date: utc0('2026-09-01'), payRole: 'foreman', amount: 1500, rateId: 'rate2' });
            expect(await dataOf({ date: '2026-09-01', payRole: 'member' })).toMatchObject({ date: utc0('2026-09-01'), payRole: 'member', amount: 200, rateId: 'rate2' });
            // 金額を変える前の日付には、前の金額（8/1 から: 職長 1,000円・職長以外 100円）
            expect(await dataOf({ date: '2026-08-31', payRole: 'foreman' })).toMatchObject({ date: utc0('2026-08-31'), payRole: 'foreman', amount: 1000, rateId: 'rate1' });
            expect(await dataOf({ date: '2026-08-31', payRole: 'member' })).toMatchObject({ date: utc0('2026-08-31'), payRole: 'member', amount: 100, rateId: 'rate1' });
            // 手当の始まりの日（いちばん古い適用開始日）の当日は、最初の金額で付けられる
            expect(await dataOf({ date: '2026-08-01', payRole: 'foreman' })).toMatchObject({ date: utc0('2026-08-01'), amount: 1000, rateId: 'rate1' });
            expect(await dataOf({ date: '2026-08-01', payRole: 'member' })).toMatchObject({ date: utc0('2026-08-01'), amount: 100, rateId: 'rate1' });
            // 金額は、その手当の行だけを読む
            expect(mock(prisma.allowanceRate.findMany).mock.calls.length).toBeGreaterThan(0);
            for (const call of mock(prisma.allowanceRate.findMany).mock.calls) {
                expect(call[0].where).toEqual({ itemId: { in: ['large'] } });
            }
        });

        it('同じ適用開始日の金額が2行あるときは、後から入れた行を使う（打ちまちがいを、同じ日付で入れ直したとき）', async () => {
            mock(prisma.allowanceRate.findMany).mockResolvedValue([
                { id: 'fixed', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-02T00:00:00.000Z') },
                { id: 'typo', itemId: 'large', foremanAmount: 15000, memberAmount: 2000, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T00:00:00.000Z') },
            ]);
            expect(await dataOf({ payRole: 'foreman' })).toMatchObject({ amount: 1500, rateId: 'fixed' });
            expect(await dataOf({ payRole: 'member' })).toMatchObject({ amount: 200, rateId: 'fixed' });
        });

        it('payRole は、送られた値をそのまま使う（その人の役職では決めない）', async () => {
            // 役職が作業員の人を「職長として」／役職が職長の人を「職長以外として」
            expect(await dataOf({ userId: 'worker1', payRole: 'foreman' })).toMatchObject({ userId: 'worker1', payRole: 'foreman', amount: 1500 });
            expect(await dataOf({ userId: 'foremanA', payRole: 'member' })).toMatchObject({ userId: 'foremanA', payRole: 'member', amount: 200 });
        });

        it('メモは、前後の空白（全角の空白・改行も）を取って 200字まで。空・空白だけ・null・無しは null', async () => {
            const noteOf = async (note: unknown) => {
                mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
                const r = await postRecord(body(note === undefined ? {} : { note }));
                expect([JSON.stringify(note), r.status]).toEqual([JSON.stringify(note), 201]);
                return [insertArgs().data[0].note, r.body.record?.note];
            };
            const max = 'あ'.repeat(200);
            expect(await noteOf('  押し忘れの分  ')).toEqual(['押し忘れの分', '押し忘れの分']);
            expect(await noteOf('\u3000押し忘れの分\u3000\n')).toEqual(['押し忘れの分', '押し忘れの分']);
            expect(await noteOf(max)).toEqual([max, max]);
            // 字数は、空白を取ってから数える
            expect(await noteOf(`  ${max}  `)).toEqual([max, max]);
            for (const empty of ['', '   ', '\u3000', null, undefined]) {
                expect(await noteOf(empty)).toEqual([null, null]);
            }
        });

        it('送られてきた金額・状態・付けた人などは使わない（金額は金額の表から・状態は決まりから・付けた人はログインしている人）', async () => {
            const r = await postRecord(body({
                userId: 'admin1', id: 'my-id', amount: 99999, status: 'confirmed', source: 'attendance', foremanId: 'foremanA', itemName: 'にせの名前',
                rateId: 'rate1', createdBy: 'worker1', createdByName: 'にせの人', confirmedBy: 'admin1', confirmedByName: '管理者1', confirmedAt: '2026-09-10T00:00:00.000Z',
            }));
            expect(r.status).toBe(201);
            expect(insertArgs().data).toEqual([{
                userId: 'admin1', date: utc0('2026-09-10'), itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, rateId: 'rate2',
                status: 'pending', source: 'manual', foremanId: null, note: null,
                createdBy: 'admin1', createdByName: '管理者1',
            }]);
        });

        it('表示名が無いセッションでは、名前の写しはログイン名（username）。id にログイン名は使わない', async () => {
            loginAs({ id: 'admin1', role: 'admin' });
            expect(await dataOf()).toMatchObject({ createdBy: 'admin1', createdByName: 'login-admin1', status: 'confirmed' });
            expect(writtenLogs()[0]).toMatchObject({ actorId: 'admin1', actorName: 'login-admin1' });
        });

        it('対象の現場へ手配されているか・出勤簿は見ない（手配に無い人・日にも付けられる）', async () => {
            expect((await postRecord(body())).status).toBe(201);
            expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
            expect(prisma.projectAssignment.findUnique).not.toHaveBeenCalled();
            expect(prisma.projectAssignment.count).not.toHaveBeenCalled();
            expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
            expect(prisma.attendanceRecord.findFirst).not.toHaveBeenCalled();
            expect(prisma.attendanceRecord.findUnique).not.toHaveBeenCalled();
            expect(prisma.attendanceRecord.count).not.toHaveBeenCalled();
        });

        it('保存は、1つのトランザクションの中で「鍵 → 締めの確かめ → 入れる → 履歴」の順。トランザクションには、待ち時間の設定（最大 5秒待って始め、10秒まで）を渡す', async () => {
            expect((await postRecord(body())).status).toBe(201);
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(transactionOptions()).toEqual(TX_OPTIONS);
            expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
            expect(lockSql()).toContain('pg_advisory_xact_lock');
            expectOrder([
                ['トランザクションを開く', firstCall(prisma.$transaction)],
                ['鍵', firstCall(prisma.$executeRaw)],
                ['締めの確かめ', firstCall(prisma.allowanceMonthClose.findMany)],
                ['入れる', firstCall(prisma.allowanceRecord.createManyAndReturn)],
                ['履歴', firstCall(prisma.allowanceLog.create, prisma.allowanceLog.createMany)],
                ['トランザクションが終わる', firstCall(transactionEnd)],
            ]);
            // 締めは、記録の日付の月で確かめる
            expect(monthsAsked()).toEqual([['2026-09']]);
        });
    });

    describe('保存のときに断る', () => {
        it('締めた月の日付 → 400「この月は締めてあります（管理者が締めを外すと、変えられます）」。何も入れない', async () => {
            closedMonths = ['2026-08'];
            const r = await postRecord(body({ date: '2026-08-31' }));
            expect([r.status, r.body.error]).toEqual([400, CLOSED_MESSAGE]);
            nothingWritten();
            // 締めは、鍵を取ったあとで、記録の日付の月で確かめる
            expect(monthsAsked()).toEqual([['2026-08']]);
            expectOrder([
                ['鍵', firstCall(prisma.$executeRaw)],
                ['締めの確かめ', firstCall(prisma.allowanceMonthClose.findMany)],
                ['トランザクションが終わる', firstCall(transactionEnd)],
            ]);

            // 締めていない月（9月）の日付には付けられる
            expect((await postRecord(body({ date: '2026-09-01' }))).status).toBe(201);
        });

        it('すでにある（同じ人・同じ日・同じ手当。入らなかった）→ 400「その日のその手当は、すでに付いています」。履歴は書かない', async () => {
            mock(prisma.allowanceRecord.createManyAndReturn).mockResolvedValue([]); // skipDuplicates で入らなかった
            const r = await postRecord(body());
            expect([r.status, r.body.error]).toEqual([400, 'その日のその手当は、すでに付いています']);
            expect(insertArgs().skipDuplicates).toBe(true);
            expect(writtenLogs()).toEqual([]);
        });

        it('手当が始まる前の日付（いちばん古い適用開始日より前）→ 400「この日付には、この手当の金額が設定されていません…」。何も入れない・履歴も書かない', async () => {
            // 大規模手当の始まりの日は 8/1。その前の日（7/31）・もっと前の日には付けられない（最初の金額をさかのぼって使わない）
            for (const date of ['2026-07-31', '2026-07-01', '2025-12-31']) {
                for (const payRole of ['foreman', 'member']) {
                    const r = await postRecord(body({ date, payRole }));
                    expect([date, payRole, r.status, r.body.error]).toEqual([date, payRole, 400, NO_RATE_MESSAGE]);
                }
            }
            // 入れる行が無いので、createManyAndReturn を呼ばない
            nothingWritten();
            // 金額は、その手当の行だけを読んで決める
            expect(mock(prisma.allowanceRate.findMany).mock.calls[0][0].where).toEqual({ itemId: { in: ['large'] } });

            // 始まりの日の当日（8/1）は付けられる
            const first = await postRecord(body({ date: '2026-08-01' }));
            expect([first.status, first.body.record?.date, first.body.record?.amount]).toEqual([201, '2026-08-01', 100]);
        });

        it('金額の行が1つも無い手当 → 同じ 400「この日付には、この手当の金額が設定されていません…」。何も入れない', async () => {
            const r = await postRecord(body({ itemId: 'norate' }));
            expect([r.status, r.body.error]).toEqual([400, NO_RATE_MESSAGE]);
            expect(mock(prisma.allowanceRate.findMany).mock.calls[0][0].where).toEqual({ itemId: { in: ['norate'] } });
            nothingWritten();
        });

        it('いくつも当てはまるときは「締めた月 → 金額なし → すでにある」の順で断る', async () => {
            closedMonths = ['2026-07', '2026-08'];
            mock(prisma.allowanceRecord.createManyAndReturn).mockResolvedValue([]); // 入れに行けば「すでにある」になる状態

            const results = [
                await postRecord(body({ date: '2026-07-31' })),                    // 締めた月で、手当が始まる前の日付
                await postRecord(body({ date: '2026-07-31', itemId: 'norate' })),  // 締めた月で、金額の行が無い手当
                await postRecord(body({ date: '2026-08-31' })),                    // 締めた月で、すでにある
            ];
            expect(results.map((r) => [r.status, r.body.error])).toEqual([[400, CLOSED_MESSAGE], [400, CLOSED_MESSAGE], [400, CLOSED_MESSAGE]]);
            expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();

            // 締めを外すと、次の理由で断る: 始まる前の日付は「金額なし」（入れに行かない）、金額のある日付は「すでにある」
            closedMonths = [];
            const noRate = await postRecord(body({ date: '2026-07-31' }));
            expect([noRate.status, noRate.body.error]).toEqual([400, NO_RATE_MESSAGE]);
            expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();

            const duplicate = await postRecord(body({ date: '2026-08-31' }));
            expect([duplicate.status, duplicate.body.error]).toEqual([400, 'その日のその手当は、すでに付いています']);
            expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
            expect(writtenLogs()).toEqual([]);
        });
    });
});

// ================================================================ PATCH

describe('PATCH /records（確認待ちを認める）', () => {
    it('形が違う → 400「入力が不正です」。何も読まず、何も書かない', async () => {
        const cases: [string, unknown][] = [
            ['action が違う', { action: 'approve', ids: ['a'] }],
            ['action が無い', { ids: ['a'] }],
            ['ids が無い', { action: 'confirm' }],
            ['ids が配列でない', { action: 'confirm', ids: 'a' }],
            ['ids が null', { action: 'confirm', ids: null }],
            ['ids に数が入っている', { action: 'confirm', ids: ['a', 1] }],
            ['ids に空文字が入っている', { action: 'confirm', ids: ['a', ''] }],
            ['ids に null が入っている', { action: 'confirm', ids: [null] }],
            ['JSON として読めない', 'これは JSON ではない'],
            ['null', 'null'],
            ['配列', '[{"action":"confirm","ids":["a"]}]'],
        ];
        for (const [label, b] of cases) {
            const r = await patchRecords(b);
            expect([label, r.status, r.body.error, r.body.details]).toEqual([label, 400, 'Validation Error', '入力が不正です']);
        }
        noReads();
        noWrites();
    });

    it('ids は1回に 1000件まで。1001件は 400', async () => {
        const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
        const over = await patchRecords({ action: 'confirm', ids: ids(1001) });
        expect([over.status, over.body.details]).toEqual([400, '入力が不正です']);
        noReads();
        noWrites();

        // 1000件は受け付ける（どれも DB に無いので、全部 skipped）
        const max = await patchRecords({ action: 'confirm', ids: ids(1000) });
        expect([max.status, max.body]).toEqual([200, { confirmed: 0, skipped: 1000 }]);
    });

    it('ids が空の配列 → 200 { confirmed: 0, skipped: 0 }。DB に触らない', async () => {
        const r = await patchRecords({ action: 'confirm', ids: [] });
        expect([r.status, r.body, r.cache]).toEqual([200, { confirmed: 0, skipped: 0 }, 'no-store']);
        noReads();
        noWrites();
    });

    it('認める: まとめて1回の updateMany（条件は「認めてよい記録の ID で、まだ確認待ち」）。認めた人と日時を入れる。履歴は1件につき1行。応答は { confirmed, skipped }', async () => {
        freezeNow('2026-10-02T03:00:00.000Z');
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            pendingRow({ id: 'ok1' }),
            pendingRow({ id: 'ok2', userId: 'manager1', payRole: 'member', amount: 200, date: utc0('2026-09-11'), createdBy: 'manager1', createdByName: 'マネージャー1' }),
        ]);
        const r = await patchRecords({ action: 'confirm', ids: ['ok1', 'ok2'] });
        expect([r.status, r.body, r.cache]).toEqual([200, { confirmed: 2, skipped: 0 }, 'no-store']);

        // 読むのは、送られた ID の記録だけ。認めてよいかの判定・締めの確かめ・履歴に要る列を読む
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        const findArgs = mock(prisma.allowanceRecord.findMany).mock.calls[0][0] as { where: unknown; select: unknown };
        expect(findArgs.where).toEqual({ id: { in: ['ok1', 'ok2'] } });
        expect(findArgs.select).toMatchObject({
            id: true, userId: true, date: true, itemId: true, itemName: true, payRole: true, amount: true, status: true, createdBy: true,
        });

        // 2件でも、updateMany は1回だけ（1件ずつ変えない）
        expect(prisma.allowanceRecord.updateMany).toHaveBeenCalledTimes(1);
        const update = mock(prisma.allowanceRecord.updateMany).mock.calls[0][0] as { where: { id: { in: string[] } }; data: { confirmedAt: Date } };
        expect({ ...update.where, id: { in: [...update.where.id.in].sort() } }).toEqual({ id: { in: ['ok1', 'ok2'] }, status: 'pending' });
        expect({ ...update.data, confirmedAt: update.data.confirmedAt.toISOString() }).toEqual({
            status: 'confirmed', confirmedBy: 'admin1', confirmedByName: '管理者1', confirmedAt: '2026-10-02T03:00:00.000Z',
        });

        expect(writtenLogs().map((l) => ({ ...l, recordDate: (l.recordDate as Date).toISOString() }))).toEqual([
            {
                action: 'record_confirmed', actorId: 'admin1', actorName: '管理者1', targetUserId: 'foremanA', itemId: 'large', recordId: 'ok1',
                recordDate: '2026-09-10T00:00:00.000Z', detail: { itemName: '大規模手当', payRole: 'foreman', amount: 1500 },
            },
            {
                action: 'record_confirmed', actorId: 'admin1', actorName: '管理者1', targetUserId: 'manager1', itemId: 'large', recordId: 'ok2',
                recordDate: '2026-09-11T00:00:00.000Z', detail: { itemName: '大規模手当', payRole: 'member', amount: 200 },
            },
        ]);
        // 認めるだけ（記録を足さない・消さない）
        expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
        expect(prisma.allowanceRecord.deleteMany).not.toHaveBeenCalled();
    });

    it('自分の分・確定済み・締めた月の記録・無い ID は skipped に数える。ids の重なりは除く', async () => {
        closedMonths = ['2026-08'];
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            pendingRow({ id: 'own', userId: 'admin1', createdBy: 'admin1' }),   // 自分の分
            recordRow({ id: 'done' }),                                           // すでに確定
            pendingRow({ id: 'closed', date: utc0('2026-08-31') }),              // 締めた月
            pendingRow({ id: 'ok' }),
        ]);
        const r = await patchRecords({ action: 'confirm', ids: ['own', 'done', 'closed', 'ok', 'missing', 'ok', 'own'] });
        expect([r.status, r.body]).toEqual([200, { confirmed: 1, skipped: 4 }]);

        // 読むのは、重なりを除いた ID
        expect(mock(prisma.allowanceRecord.findMany).mock.calls[0][0].where).toEqual({ id: { in: ['own', 'done', 'closed', 'ok', 'missing'] } });
        // 締めは、読んだ記録の日付の月で確かめる
        expect(monthsAsked()).toEqual([['2026-08', '2026-09']]);
        // 変えるのも、履歴を書くのも、認めてよい1件だけ
        expect(mock(prisma.allowanceRecord.updateMany).mock.calls.map((c) => c[0].where)).toEqual([{ id: { in: ['ok'] }, status: 'pending' }]);
        expect(writtenLogs().map((l) => [l.action, l.recordId])).toEqual([['record_confirmed', 'ok']]);
    });

    it('自分の分だけを送ると、何も変えずに全部 skipped（だれも自分の手当を自分だけでは決められない）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([pendingRow({ id: 'own', userId: 'admin1', createdBy: 'admin1' })]);
        const r = await patchRecords({ action: 'confirm', ids: ['own'] });
        expect([r.status, r.body]).toEqual([200, { confirmed: 0, skipped: 1 }]);
        nothingWritten();

        // 同じ記録を、マネージャーなら認められる
        loginAs(MANAGER);
        expect((await patchRecords({ action: 'confirm', ids: ['own'] })).body).toEqual({ confirmed: 1, skipped: 0 });
    });

    it('締めた月の記録だけを送ると、何も変えずに全部 skipped。締めを外せば認められる', async () => {
        closedMonths = ['2026-08'];
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([pendingRow({ id: 'aug', date: utc0('2026-08-31') })]);
        const r = await patchRecords({ action: 'confirm', ids: ['aug'] });
        expect([r.status, r.body]).toEqual([200, { confirmed: 0, skipped: 1 }]);
        nothingWritten();

        closedMonths = [];
        expect((await patchRecords({ action: 'confirm', ids: ['aug'] })).body).toEqual({ confirmed: 1, skipped: 0 });
    });

    it('認めた件数が、認めてよい記録の件数と合わなければ、全部を取りやめる（500。履歴は書かない・トランザクションの中で例外にする）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([pendingRow({ id: 'p1' }), pendingRow({ id: 'p2', date: utc0('2026-09-11') })]);

        // 2件を認めるはずが、1件しか変わらなかった・1件も変わらなかった・多く変わった
        for (const count of [1, 0, 3]) {
            jest.clearAllMocks();
            mock(prisma.allowanceRecord.updateMany).mockResolvedValue({ count });
            const r = await patchRecords({ action: 'confirm', ids: ['p1', 'p2'] });
            expect([count, r.status, r.body.error]).toEqual([count, 500, '手当の記録の確認']);
            expect([count, r.body.confirmed, r.body.skipped]).toEqual([count, undefined, undefined]);
            // 「一部だけ認めた」という履歴を残さない
            expect(writtenLogs()).toEqual([]);
            // 例外は、$transaction に渡した関数の中から出る（本物の DB では、変えた分ごと取りやめになる）
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            await expect(mock(prisma.$transaction).mock.results[0].value).rejects.toThrow();
        }

        // 件数が合えば、認められる
        jest.clearAllMocks();
        mock(prisma.allowanceRecord.updateMany).mockResolvedValue({ count: 2 });
        expect((await patchRecords({ action: 'confirm', ids: ['p1', 'p2'] })).body).toEqual({ confirmed: 2, skipped: 0 });
        expect(writtenLogs().map((l) => l.recordId)).toEqual(['p1', 'p2']);
    });

    it('認めるのは、1つのトランザクションの中で「鍵 → 記録を読む → 締めの確かめ → 認める → 履歴」の順。トランザクションには、待ち時間の設定を渡す', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([pendingRow({ id: 'ok' })]);
        expect((await patchRecords({ action: 'confirm', ids: ['ok'] })).body).toEqual({ confirmed: 1, skipped: 0 });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(transactionOptions()).toEqual(TX_OPTIONS);
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(lockSql()).toContain('pg_advisory_xact_lock');
        expectOrder([
            ['トランザクションを開く', firstCall(prisma.$transaction)],
            ['鍵', firstCall(prisma.$executeRaw)],
            ['記録を読む', firstCall(prisma.allowanceRecord.findMany)],
            ['締めの確かめ', firstCall(prisma.allowanceMonthClose.findMany)],
            ['認める', firstCall(prisma.allowanceRecord.updateMany)],
            ['履歴', firstCall(prisma.allowanceLog.create, prisma.allowanceLog.createMany)],
            ['トランザクションが終わる', firstCall(transactionEnd)],
        ]);
    });
});

// ================================================================ DELETE

describe('DELETE /records/[id]', () => {
    it('無ければ 404「記録が見つかりません」', async () => {
        const r = await deleteRecord('nope');
        expect([r.status, r.body.error]).toEqual([404, '記録が見つかりません']);
        // 記録は ID で、列を絞らずに読む（取り消したときに、履歴へ全部の列を写すため）
        expect(prisma.allowanceRecord.findUnique).toHaveBeenCalledWith({ where: { id: 'nope' } });
        nothingWritten();
    });

    it('締めた月の記録 → 400「この月は締めてあります（管理者が締めを外すと、変えられます）」。締めを外せば取り消せる', async () => {
        closedMonths = ['2026-08'];
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(recordRow({ id: 'aug', date: utc0('2026-08-31') }));
        const r = await deleteRecord('aug');
        expect([r.status, r.body.error]).toEqual([400, CLOSED_MESSAGE]);
        // 締めは、記録の日付の月で確かめる
        expect(monthsAsked()).toEqual([['2026-08']]);
        nothingWritten();

        closedMonths = [];
        expect((await deleteRecord('aug')).status).toBe(200);
    });

    it('確定した自分の分 → 403「自分の分の記録は、自分では取り消せません（ほかの管理者・マネージャーに頼んでください）」', async () => {
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(
            recordRow({ id: 'mine', userId: 'admin1', createdBy: 'admin1', confirmedBy: 'manager1', confirmedByName: 'マネージャー1', confirmedAt: new Date('2026-09-11T01:00:00.000Z') }),
        );
        const r = await deleteRecord('mine');
        expect([r.status, r.body.error]).toEqual([403, OWN_RECORD_MESSAGE]);
        nothingWritten();
    });

    it('締めた月の確かめが、権限の確かめより先（締めた月にある「確定した自分の分」は 403 ではなく 400）', async () => {
        closedMonths = ['2026-08'];
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(recordRow({ id: 'mine', userId: 'admin1', date: utc0('2026-08-31'), createdBy: 'admin1' }));
        const r = await deleteRecord('mine');
        expect([r.status, r.body.error]).toEqual([400, CLOSED_MESSAGE]);
        nothingWritten();
    });

    it('取り消す: 条件は「その ID で、読んだときの status」。履歴に、取り消した記録の全部の列を残す（日付は YYYY-MM-DD・日時は ISO の文字）', async () => {
        const row = recordRow({
            id: 'r1', userId: 'foremanA', payRole: 'foreman', amount: 1500, note: '現場の職長',
            confirmedBy: 'manager1', confirmedByName: 'マネージャー1', confirmedAt: new Date('2026-09-11T01:00:00.000Z'),
            updatedAt: new Date('2026-09-11T01:00:00.000Z'),
        });
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(row);
        const r = await deleteRecord('r1');
        expect([r.status, r.body, r.cache]).toEqual([200, { ok: true }, 'no-store']);

        expect(prisma.allowanceRecord.findUnique).toHaveBeenCalledWith({ where: { id: 'r1' } });
        expect(mock(prisma.allowanceRecord.deleteMany).mock.calls).toEqual([[{ where: { id: 'r1', status: 'confirmed' } }]]);
        expect(writtenLogs()).toEqual([{
            action: 'record_removed', actorId: 'admin1', actorName: '管理者1', targetUserId: 'foremanA', itemId: 'large', recordId: 'r1',
            recordDate: utc0('2026-09-10'),
            detail: {
                id: 'r1', userId: 'foremanA', date: '2026-09-10', itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500,
                rateId: 'rate2', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: '現場の職長',
                createdBy: 'foremanA', createdByName: '職長A', confirmedBy: 'manager1', confirmedByName: 'マネージャー1',
                confirmedAt: '2026-09-11T01:00:00.000Z', createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-11T01:00:00.000Z',
            },
        }]);
        // 取り消すだけ（記録を足さない・書き換えない）
        expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
        expect(prisma.allowanceRecord.updateMany).not.toHaveBeenCalled();
    });

    it('自分で付けた自分の確認待ちは、取り下げられる（条件の status は pending）。ほかの人の確認待ちも取り消せる', async () => {
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(pendingRow({ id: 'own', userId: 'admin1', createdBy: 'admin1', createdByName: '管理者1' }));
        expect((await deleteRecord('own')).body).toEqual({ ok: true });
        expect(mock(prisma.allowanceRecord.deleteMany).mock.calls).toEqual([[{ where: { id: 'own', status: 'pending' } }]]);
        expect(writtenLogs()).toEqual([expect.objectContaining({
            action: 'record_removed', actorId: 'admin1', targetUserId: 'admin1', recordId: 'own',
            detail: expect.objectContaining({ id: 'own', status: 'pending', date: '2026-09-10', confirmedAt: null }),
        })]);

        jest.clearAllMocks();
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(pendingRow({ id: 'p1' }));
        expect((await deleteRecord('p1')).body).toEqual({ ok: true });
        expect(mock(prisma.allowanceRecord.deleteMany).mock.calls).toEqual([[{ where: { id: 'p1', status: 'pending' } }]]);
    });

    it('マネージャーも取り消せる（ほかの人の分なら、確定でも、管理者の分でも）。確定した自分の分は取り消せない', async () => {
        loginAs(MANAGER);
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(recordRow({ id: 'admins', userId: 'admin1', createdBy: 'admin1', confirmedBy: 'manager1' }));
        expect((await deleteRecord('admins')).body).toEqual({ ok: true });
        expect(writtenLogs()).toEqual([expect.objectContaining({ action: 'record_removed', actorId: 'manager1', actorName: 'マネージャー1', targetUserId: 'admin1', recordId: 'admins' })]);

        jest.clearAllMocks();
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(recordRow({ id: 'mine', userId: 'manager1', createdBy: 'manager1', confirmedBy: 'admin1' }));
        const r = await deleteRecord('mine');
        expect([r.status, r.body.error]).toEqual([403, OWN_RECORD_MESSAGE]);
        nothingWritten();
    });

    it('読んだあとで状態が変わっていた（消えた件数 0）→ 400「記録の状態が変わっています。画面を読み直してください」。履歴は書かない', async () => {
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(pendingRow({ id: 'p1' }));
        mock(prisma.allowanceRecord.deleteMany).mockResolvedValue({ count: 0 });
        const r = await deleteRecord('p1');
        expect([r.status, r.body.error]).toEqual([400, '記録の状態が変わっています。画面を読み直してください']);
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
        expect(writtenLogs()).toEqual([]);
    });

    it('取り消すのは、1つのトランザクションの中で「鍵 → 記録を読む → 締めの確かめ → 消す → 履歴」の順。トランザクションには、待ち時間の設定を渡す', async () => {
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(recordRow({ id: 'r1' }));
        expect((await deleteRecord('r1')).status).toBe(200);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(transactionOptions()).toEqual(TX_OPTIONS);
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(lockSql()).toContain('pg_advisory_xact_lock');
        expectOrder([
            ['トランザクションを開く', firstCall(prisma.$transaction)],
            ['鍵', firstCall(prisma.$executeRaw)],
            ['記録を読む', firstCall(prisma.allowanceRecord.findUnique)],
            ['締めの確かめ', firstCall(prisma.allowanceMonthClose.findMany)],
            ['消す', firstCall(prisma.allowanceRecord.deleteMany)],
            ['履歴', firstCall(prisma.allowanceLog.create, prisma.allowanceLog.createMany)],
            ['トランザクションが終わる', firstCall(transactionEnd)],
        ]);
    });
});

// ================================================================ 全体

describe('全体: 書き込みの鍵・毎回サーバーで実行する設定・DB が失敗したとき', () => {
    it('どちらの route も、毎回サーバーで実行する設定になっている（応答を作り置きしない）', () => {
        expect([recordsRoute.dynamic, recordByIdRoute.dynamic]).toEqual(['force-dynamic', 'force-dynamic']);
    });

    it('足す・認める・取り消すは、どれも同じ鍵を取り、同じ待ち時間の設定のトランザクションで行う（月の締めと同時に行われないように、1つずつ順番に行う）', async () => {
        const lockOf = async (run: () => Promise<{ status: number }>, status: number) => {
            mock(prisma.$executeRaw).mockClear();
            mock(prisma.$transaction).mockClear();
            expect((await run()).status).toBe(status);
            expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(transactionOptions()).toEqual(TX_OPTIONS);
            return lockSql();
        };
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([pendingRow({ id: 'p1' })]);
        mock(prisma.allowanceRecord.findUnique).mockResolvedValue(recordRow({ id: 'r1' }));

        const added = await lockOf(() => postRecord({ userId: 'worker1', date: '2026-09-10', itemId: 'large', payRole: 'member' }), 201);
        const confirmed = await lockOf(() => patchRecords({ action: 'confirm', ids: ['p1'] }), 200);
        const removed = await lockOf(() => deleteRecord('r1'), 200);
        expect(added).toContain('pg_advisory_xact_lock');
        expect([confirmed, removed]).toEqual([added, added]);
    });

    it('DB が失敗したら、どの操作も 500 で返す（入れるのに失敗したら、履歴も書かない）', async () => {
        const failure = new Error('DB につながらない');
        mock(prisma.allowanceRecord.findMany).mockRejectedValue(failure);
        mock(prisma.allowanceRecord.findUnique).mockRejectedValue(failure);
        mock(prisma.allowanceRecord.createManyAndReturn).mockRejectedValue(failure);
        const results = [
            await getRecords('month=2026-09'),
            await postRecord({ userId: 'worker1', date: '2026-09-10', itemId: 'large', payRole: 'member' }),
            await patchRecords({ action: 'confirm', ids: ['p1'] }),
            await deleteRecord('r1'),
        ];
        // モックの serverErrorResponse は、渡された操作の名前をそのまま error に入れる（本物は「◯◯に失敗しました」と返す）
        expect(results.map((r) => [r.status, r.body.error])).toEqual([
            [500, '手当の記録の取得'], [500, '手当の記録の追加'], [500, '手当の記録の確認'], [500, '手当の記録の取り消し'],
        ]);
        expect(writtenLogs()).toEqual([]);
    });
});
