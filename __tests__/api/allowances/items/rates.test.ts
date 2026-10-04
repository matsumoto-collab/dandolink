/**
 * @jest-environment node
 *
 * 手当の金額の履歴の API のテスト（docs/指示書_大規模手当.md の 6-1）。
 *   GET    /api/allowances/items/[id]/rates            金額の履歴（予約・今の金額・以前 の状態と、置きかえられた印つき）。admin・manager
 *   POST   /api/allowances/items/[id]/rates            金額を変える（行を足すだけ＝追記のみ）。admin だけ
 *   DELETE /api/allowances/items/[id]/rates/[rateId]   まだ始まっていない予約を取り消す。admin だけ
 *
 * 評価ポイントの点数の履歴（__tests__/api/evaluation-points/items/rates.test.ts）と同じ形の API だが、次の点が違う:
 *   - 金額は2つ（職長 foremanAmount・職長以外 memberAmount）。どちらも 0〜100000 の整数
 *   - どの適用開始日よりも前の日付には、金額が無い（いちばん古い適用開始日が、その手当の始まりの日）
 *   - 適用開始日は、今日以降（予約）のほか、過去の日付も選べる（さかのぼった変更・打ちまちがいの直し）。
 *     ただし、手当の始まりの日より前と、その日の月からあとに締めた月があるときは、足せない
 *   - 適用開始日が今日以前の行を足すと、その日からあとの、すでに付いている記録の金額も、新しい金額になる
 *
 * いちばん守りたい約束:
 *   - 金額を変えられるのは管理者だけ。締めた月の記録の金額は変わらない（締めを外してからでないと、その月にかかる金額は足せない）
 *   - 金額の行は、足すだけ（直さない）。消せるのは、まだ始まっていない予約だけ（ほかの手当の行は、この手当の URL では消せない）
 *   - 足す・記録を合わせる・取り消す・履歴は、どれも「書き込みの鍵 → 確かめる → 書く → 履歴」を、1つのトランザクションの中で行う
 *     （「今日」は、鍵を取ったあとで決める。待っているあいだに日付が変わっても、変わったあとの日で判定する）
 *
 * route は、lib/allowances.ts・lib/allowancesServer.ts（addAllowanceRate・cancelAllowanceRate）・lib/allowancesReport.ts の関数を、本物のまま呼ぶ。
 * @/lib/prisma と @/lib/api/utils だけは、jest.setup.ts がモックに差し替えている。
 * このファイルでは、モックの prisma を「小さな DB の代わり」にしてある（beforeEach を参照）:
 *   金額の履歴（rateRows）・記録（recordRows）・締めた月（closedMonths）の表を持ち、渡された where・orderBy のとおりに答え、
 *   create・updateMany・delete は表の中身を書き換える。書かれた履歴は logs に残る。
 *   だから、「記録の金額が新しい金額になったか」は、API を呼んだあとの表の中身で確かめられる。
 * 大事な絞り込み（締めた月・記録の読み方）は、渡した引数でも確かめる。
 *
 * $transaction は、jest.setup.ts と同じ動き（同じモックの prisma を渡して、すぐ実行する）のまま、
 * 「トランザクションの中（tx）から呼ばれた操作の名前」（txCalls。鍵＝$executeRaw も入る）と「終わり方」（transactionOutcomes）を残すようにしてある。
 * tx を通さずに（外の prisma で）読み書きした操作は callsOutsideTx() で分かる。
 *
 * 日付: どのテストも「今日」を見るので、時計（Date だけ）を 日本時間 2026-10-03 12:00 に固定する（freezeNow）。
 * 日本時間で決めているかを確かめるテストでは、UTC ではまだ前の日の時刻（日本時間 0:30 など）に固定し直す。
 */
import { NextRequest, NextResponse } from 'next/server';
import * as ratesRoute from '@/app/api/allowances/items/[id]/rates/route';
import * as rateByIdRoute from '@/app/api/allowances/items/[id]/rates/[rateId]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const { GET, POST } = ratesRoute;
const { DELETE } = rateByIdRoute;

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

// ---------------------------------------------------------------- ログインしている人

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
/** ログインしていない（応答の本文は1回しか読めないので、呼ばれるたびに新しい応答を作る） */
const logout = () =>
    mock(requireAuth).mockImplementation(async () => ({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }));
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER = { id: 'manager1', role: 'manager', name: 'マネージャー1' };
/** 管理者でもマネージャーでもない人たち */
const OTHERS = [
    { id: 'foremanA', role: 'foreman1', name: '職長A' },
    { id: 'foremanB', role: 'foreman2', name: '職長B' },
    { id: 'worker1', role: 'worker', name: '作業員1' },
    { id: 'partner1', role: 'partner', name: '協力会社' },
    { id: 'partnerMember1', role: 'partner_member', name: '協力会社のメンバー' },
    { id: 'accountant1', role: 'accountant', name: '税理士' },
    { id: 'support1', role: 'support', name: '応援' },
];

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
/** いつもの「今」: 日本時間 2026-10-03 12:00（今日は 2026-10-03） */
const NOON = '2026-10-03T03:00:00.000Z';

// ---------------------------------------------------------------- 呼び方と、応答の読み方

const jsonRequest = (urlPath: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        // 文字列は、そのまま body にする（JSON として読めない body を送るため）
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

/** 金額の履歴の1行（GET の配列の中身・POST の { rate }） */
interface RateBody {
    id: string; foremanAmount: number; memberAmount: number; effectiveFrom: string; createdByName: string; createdAt: string;
    state: string; replaced: boolean;
}
interface Body { error?: string; details?: string; ok?: boolean; rate?: RateBody; repriced?: number }

const getRates = async (id = 'large') => {
    const res = await GET(jsonRequest(`/api/allowances/items/${id}/rates`, 'GET'), { params: { id } });
    return { status: res.status, body: (await res.json()) as unknown, cache: res.headers.get('Cache-Control') };
};
/** GET の応答を、金額の行の配列として読む（配列でなければ、その場でテストを落とす） */
const ratesOf = (r: { body: unknown }): RateBody[] => {
    if (!Array.isArray(r.body)) throw new Error(`応答が配列ではありません: ${JSON.stringify(r.body)}`);
    return r.body as RateBody[];
};
/** 行の ID → 状態 */
const statesOf = (r: { body: unknown }) => Object.fromEntries(ratesOf(r).map((x) => [x.id, x.state]));
/** 応答の並びのまま [ID, 状態, 置きかえられたか] */
const marksOf = (r: { body: unknown }) => ratesOf(r).map((x) => [x.id, x.state, x.replaced]);

const postRate = async (body?: unknown, id = 'large') => {
    const res = await POST(jsonRequest(`/api/allowances/items/${id}/rates`, 'POST', body), { params: { id } });
    return { status: res.status, body: (await res.json()) as Body, cache: res.headers.get('Cache-Control') };
};
const deleteRate = async (rateId: string, id = 'large') => {
    const res = await DELETE(jsonRequest(`/api/allowances/items/${id}/rates/${rateId}`, 'DELETE'), { params: { id, rateId } });
    return { status: res.status, body: (await res.json()) as Body, cache: res.headers.get('Cache-Control') };
};

/** 形のまちがい（validationErrorResponse）は、モックでは { error: 'Validation Error', details: 文言 } になる */
const INVALID_INPUT = { error: 'Validation Error', details: '入力が不正です' };
const INVALID_AMOUNT = { error: 'Validation Error', details: '金額は 0〜100000 の整数で入れてください' };
const INVALID_DATE = { error: 'Validation Error', details: '日付が不正です' };
/** 決まりで断るもの（errorResponse）は { error: 文言 } */
const beforeStart = (startDate: string) => ({ error: `適用開始日は、手当の始まりの日（${startDate}）以降にしてください` });
const NO_START = { error: '適用開始日は、今日以降にしてください' };
const closedMonth = (month: string) => ({ error: `${month} は締めてあります。締めを外してから、金額を変えてください` });
const ALREADY_STARTED = { error: 'すでに始まっている金額は取り消せません（直すときは、同じ適用開始日で、正しい金額を入れ直してください）' };
/** 手当の書き込みの鍵（記録を足す・月を締める・手当を直す などと同じ鍵） */
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('dandolink-allowance'))";

/** 通る入力: 10/10 から（予約）、職長 1,800円・職長以外 250円 */
const VALID = { foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-10-10' };

// ---------------------------------------------------------------- DB の代わり（表の中身）

/** ある手当（AllowanceItem）の ID */
const ITEM_IDS = ['large', 'far'];

/** 金額の行（DB の全部の列） */
interface RateRow {
    id: string; itemId: string; foremanAmount: number; memberAmount: number; effectiveFrom: Date;
    createdBy: string | null; createdByName: string; createdAt: Date;
}
/** 既定は「管理者1 が 10/2 に入れた、10/10 から始まる予約（職長 1,800円・職長以外 250円）」 */
const rateRow = (over: Partial<RateRow> = {}): RateRow => ({
    id: 'rate-x', itemId: 'large', foremanAmount: 1800, memberAmount: 250, effectiveFrom: utc0('2026-10-10'),
    createdBy: 'admin1', createdByName: '管理者1', createdAt: new Date('2026-10-02T01:00:00.000Z'), ...over,
});
/** 大規模手当の、最初の金額（9/1 から 職長 1,500円・職長以外 200円。マイグレーションで作る行＝入れた人の ID は無い） */
const firstRate = (over: Partial<RateRow> = {}): RateRow => rateRow({
    id: 'rate1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'),
    createdBy: null, createdByName: '（最初の設定）', createdAt: new Date('2026-08-25T01:02:03.456Z'), ...over,
});
/** 10/1 からの金額（職長 2,000円・職長以外 300円） */
const secondRate = (over: Partial<RateRow> = {}): RateRow => rateRow({
    id: 'rate2', foremanAmount: 2000, memberAmount: 300, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-25T01:00:00.000Z'), ...over,
});

/** 記録の行（金額を合わせるときに読む列と、手当の ID） */
interface RecordRow {
    id: string; userId: string; date: Date; itemId: string; itemName: string; payRole: string; amount: number; rateId: string | null;
}
/** 既定は「大規模手当の記録」 */
const recordRow = (id: string, userId: string, dateKey: string, payRole: string, amount: number, rateId: string | null, over: Partial<RecordRow> = {}): RecordRow => ({
    id, userId, date: utc0(dateKey), itemId: 'large', itemName: '大規模手当', payRole, amount, rateId, ...over,
});

/** 金額の履歴の表。beforeEach で「大規模手当の最初の金額（9/1 から）の1行」に戻す */
let rateRows: RateRow[] = [];
/** 記録の表。beforeEach で空に戻す */
let recordRows: RecordRow[] = [];
/** 締めてある月（'YYYY-MM'）。beforeEach で空に戻す */
let closedMonths: string[] = [];
/** 書かれた履歴（allowanceLog の create・createMany に渡された行。書かれた順） */
let logs: Record<string, unknown>[] = [];
/** この テストの中で足した金額の行の数（足した行の ID は 'added-1'・'added-2'…。もとからある行の ID より小さい文字にしてある） */
let addedCount = 0;

/** 金額の履歴の表の今の中身（[ID, 適用開始日, 職長の金額, 職長以外の金額]） */
const rateTable = () => rateRows.map((r) => [r.id, r.effectiveFrom.toISOString().slice(0, 10), r.foremanAmount, r.memberAmount]);
/** 記録の表の今の中身（ID → [金額, どの金額の行から写したか]） */
const recordAmounts = () => Object.fromEntries(recordRows.map((r) => [r.id, [r.amount, r.rateId]]));

// ---------------------------------------------------------------- DB の代わり（条件の読み方）

type Row = Record<string, unknown>;
/** 2つの値の大小（日時は時刻で比べる） */
const compare = (a: unknown, b: unknown): number => {
    const x = a instanceof Date ? a.getTime() : a;
    const y = b instanceof Date ? b.getTime() : b;
    if (x === y) return 0;
    return (x as string | number) < (y as string | number) ? -1 : 1;
};
/**
 * Prisma の where を、表の1行に当てはめる（等しい・in・gte・gt・lte・lt・not だけ）。
 * 表に無い列・知らない条件が来たら例外にする（知らない条件を「全部に当てはまる」と読んで、絞り込みのまちがいを見逃さないため）
 */
const matches = (row: object, where: object | undefined): boolean =>
    Object.entries(where ?? {}).every(([column, condition]: [string, unknown]) => {
        if (!(column in row)) throw new Error(`この表に無い列で絞っています: ${column}`);
        const value = (row as Row)[column];
        if (condition === null || typeof condition !== 'object' || condition instanceof Date) return compare(value, condition) === 0;
        return Object.entries(condition).every(([operator, operand]: [string, unknown]) => {
            if (operator === 'in') return (operand as unknown[]).some((x) => compare(value, x) === 0);
            if (operator === 'gte') return compare(value, operand) >= 0;
            if (operator === 'gt') return compare(value, operand) > 0;
            if (operator === 'lte') return compare(value, operand) <= 0;
            if (operator === 'lt') return compare(value, operand) < 0;
            if (operator === 'not') return compare(value, operand) !== 0;
            throw new Error(`この条件の読み方を、テストの DB は知りません: ${column}.${operator}`);
        });
    });
/** Prisma の orderBy（[{ 列: 'asc' | 'desc' }, …]）のとおりに並べる。orderBy が無ければ、表に入っている順のまま */
const sorted = <T extends object>(rows: T[], orderBy: Record<string, 'asc' | 'desc'>[] = []): T[] =>
    [...rows].sort((a, b) => {
        for (const order of orderBy) {
            for (const [column, direction] of Object.entries(order)) {
                const c = compare((a as Row)[column], (b as Row)[column]);
                if (c !== 0) return direction === 'desc' ? -c : c;
            }
        }
        return 0;
    });
interface FindArgs { where?: object; orderBy?: Record<string, 'asc' | 'desc'>[] }

// ---------------------------------------------------------------- トランザクション

type Db = typeof prisma;
/** トランザクションの中（tx）から呼ばれた操作の名前（呼ばれた順） */
let txCalls: string[] = [];
/** $transaction に渡した関数の終わり方（'done' = 最後まで進んだ／'failed' = 例外で終わった＝本物の DB なら、中の書き込みは取り消される） */
let transactionOutcomes: ('done' | 'failed')[] = [];

/**
 * トランザクションの中で渡す prisma（tx）。中身は同じモックだが、tx を通して呼ばれた操作の名前を txCalls に残す
 * （表の操作は 'allowanceRate.create' の形、鍵は '$executeRaw'）。
 * route や lib が tx ではなく外の prisma で読み書きしたら（＝トランザクションの外で読み書きしたら）、txCalls に残らないので分かる
 */
const asTx = (db: Db): Db =>
    new Proxy(db, {
        get(target, name) {
            const member: unknown = Reflect.get(target, name);
            if (typeof name !== 'string') return member;
            // tx に直接ある関数（書き込みの鍵を取る tx.$executeRaw）
            if (typeof member === 'function') {
                return (...args: unknown[]) => {
                    txCalls.push(name);
                    return (member as (...a: unknown[]) => unknown)(...args);
                };
            }
            if (typeof member !== 'object' || member === null) return member;
            return new Proxy(member, {
                get(modelTarget, methodName) {
                    const method: unknown = Reflect.get(modelTarget, methodName);
                    if (typeof methodName !== 'string' || typeof method !== 'function') return method;
                    return (...args: unknown[]) => {
                        txCalls.push(`${name}.${methodName}`);
                        return (method as (...a: unknown[]) => unknown)(...args);
                    };
                },
            });
        },
    });

// ---------------------------------------------------------------- 確かめるための部品

/** 手当の6つの表と、書き込みに使う関数 */
const ALLOWANCE_MODELS = {
    allowanceItem: prisma.allowanceItem,
    allowanceRate: prisma.allowanceRate,
    allowanceRecord: prisma.allowanceRecord,
    allowanceMonthClose: prisma.allowanceMonthClose,
    allowanceLog: prisma.allowanceLog,
    allowanceSetting: prisma.allowanceSetting,
};
const WRITE_METHODS = ['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const;
/** その表の、書き込みに使う関数が呼ばれた回数（呼ばれたものだけ） */
const writesOf = (model: (typeof ALLOWANCE_MODELS)[keyof typeof ALLOWANCE_MODELS]) =>
    Object.fromEntries(WRITE_METHODS.map((method) => [method, mock(model[method]).mock.calls.length] as const).filter(([, n]) => n > 0));
/** 手当の表に、何も書いていないこと（金額の行も、記録も、履歴も。鍵を取って読むところまでは、進んでいてもよい） */
const nothingWritten = () => {
    for (const [name, model] of Object.entries(ALLOWANCE_MODELS)) {
        expect([name, writesOf(model)]).toEqual([name, {}]);
    }
    expect(logs).toEqual([]);
};
/** 保存の手前で断っていること（トランザクションを開いていない・鍵も取っていない・何も書いていない） */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    nothingWritten();
};
/** DB を何も読んでいないこと */
const noReads = () => {
    expect(prisma.allowanceItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRate.findUnique).not.toHaveBeenCalled();
    expect(prisma.allowanceRate.findFirst).not.toHaveBeenCalled();
    expect(prisma.allowanceRate.count).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
};
/** 鍵を取るときに実行した SQL（呼ばれた順） */
const lockSqls = () => mock(prisma.$executeRaw).mock.calls.map((c) => String(c[0]));
/** $transaction の2つめの引数（トランザクションの設定。呼ばれた順） */
const transactionOptions = () => mock(prisma.$transaction).mock.calls.map((c) => c[1] as unknown);
/**
 * tx を通さずに（外の prisma で）呼ばれた、手当の表の操作と鍵（名前 → 回数）。
 * モックは tx でも外でも同じものなので、「モックが呼ばれた回数 − tx を通して呼ばれた回数」で分かる
 */
const callsOutsideTx = (): Record<string, number> => {
    const viaTx = (name: string) => txCalls.filter((c) => c === name).length;
    const result: Record<string, number> = {};
    const lockOutside = mock(prisma.$executeRaw).mock.calls.length - viaTx('$executeRaw');
    if (lockOutside !== 0) result.$executeRaw = lockOutside;
    for (const [modelName, model] of Object.entries(ALLOWANCE_MODELS)) {
        for (const [methodName, fn] of Object.entries(model)) {
            const outside = mock(fn).mock.calls.length - viaTx(`${modelName}.${methodName}`);
            if (outside !== 0) result[`${modelName}.${methodName}`] = outside;
        }
    }
    return result;
};
/** 評価ポイントの5つの表（別のデータ）には、読むのも書くのも、いっさい触っていないこと */
const EVALUATION_POINT_MODELS = {
    evaluationPointItem: prisma.evaluationPointItem,
    evaluationPointRate: prisma.evaluationPointRate,
    evaluationPointRecord: prisma.evaluationPointRecord,
    evaluationPointLog: prisma.evaluationPointLog,
    evaluationPointSetting: prisma.evaluationPointSetting,
};
const evaluationPointsUntouched = () => {
    for (const [name, model] of Object.entries(EVALUATION_POINT_MODELS)) {
        for (const [method, fn] of Object.entries(model)) {
            expect([name, method, mock(fn).mock.calls.length]).toEqual([name, method, 0]);
        }
    }
};

/** allowanceRate.create に渡した data（いちばん最後の呼び出し） */
const createData = () => {
    const calls = mock(prisma.allowanceRate.create).mock.calls;
    return (calls[calls.length - 1][0] as { data: Record<string, unknown> }).data;
};
/** 鍵を待っているあいだに、何かが起きる（次に鍵を取るときの1回だけ） */
const whileWaitingForLock = (happen: () => void) =>
    mock(prisma.$executeRaw).mockImplementationOnce(async () => {
        happen();
        return 0;
    });

beforeEach(() => {
    jest.clearAllMocks();
    freezeNow(NOON);
    loginAs(ADMIN);
    rateRows = [firstRate()];
    recordRows = [];
    closedMonths = [];
    logs = [];
    addedCount = 0;
    txCalls = [];
    transactionOutcomes = [];

    mock(prisma.$transaction).mockImplementation(async (run: (tx: Db) => Promise<unknown>) => {
        try {
            const result = await run(asTx(prisma));
            transactionOutcomes.push('done');
            return result;
        } catch (err) {
            transactionOutcomes.push('failed');
            throw err;
        }
    });
    // 鍵は、すぐ取れる（前のテストが「1回だけ」の動きを残していても、ここで消す）
    mock(prisma.$executeRaw).mockReset();
    mock(prisma.$executeRaw).mockResolvedValue(0);

    // ---- 手当: ID で答える
    mock(prisma.allowanceItem.findUnique).mockImplementation(async ({ where }: { where: { id: string } }) =>
        (ITEM_IDS.includes(where.id) ? { id: where.id } : null));

    // ---- 金額の履歴: 渡された where・orderBy のとおりに答える。足す・消すと、表の中身が変わる
    mock(prisma.allowanceRate.findMany).mockImplementation(async ({ where, orderBy }: FindArgs) =>
        sorted(rateRows.filter((r) => matches(r, where)), orderBy));
    mock(prisma.allowanceRate.findUnique).mockImplementation(async ({ where }: { where: { id: string } }) =>
        rateRows.find((r) => r.id === where.id) ?? null);
    // 今の route は使わないが、「行があるか」をほかの読み方で調べる作りに変わっても、ある行は「ある」と答えるようにしておく
    mock(prisma.allowanceRate.findFirst).mockImplementation(async () => rateRows[0] ?? null);
    mock(prisma.allowanceRate.count).mockImplementation(async () => rateRows.length);
    // 足した行には ID が付く。入れた日時が渡されなければ、DB の既定（今）が入る
    mock(prisma.allowanceRate.create).mockImplementation(async ({ data }: { data: Omit<RateRow, 'id' | 'createdAt'> & { createdAt?: Date } }) => {
        addedCount += 1;
        const row: RateRow = { id: `added-${addedCount}`, createdAt: new Date(), ...data };
        rateRows.push(row);
        return row;
    });
    mock(prisma.allowanceRate.delete).mockImplementation(async ({ where }: { where: { id: string } }) => {
        const index = rateRows.findIndex((r) => r.id === where.id);
        if (index < 0) throw new Error(`消す行がありません: ${where.id}`);
        return rateRows.splice(index, 1)[0];
    });

    // ---- 締めた月・記録: 渡された where のとおりに答える。updateMany は、当てはまる記録を書き換える
    mock(prisma.allowanceMonthClose.findMany).mockImplementation(async ({ where }: FindArgs) =>
        closedMonths.map((month) => ({ month })).filter((r) => matches(r, where)));
    mock(prisma.allowanceRecord.findMany).mockImplementation(async ({ where, orderBy }: FindArgs) =>
        sorted(recordRows.filter((r) => matches(r, where)), orderBy));
    mock(prisma.allowanceRecord.updateMany).mockImplementation(async ({ where, data }: { where: object; data: Partial<RecordRow> }) => {
        const targets = recordRows.filter((r) => matches(r, where));
        for (const r of targets) Object.assign(r, data);
        return { count: targets.length };
    });

    // ---- 履歴: 書かれた行を logs に残す
    mock(prisma.allowanceLog.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return data;
    });
    mock(prisma.allowanceLog.createMany).mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) => {
        logs.push(...data);
        return { count: data.length };
    });
});

afterEach(() => {
    jest.useRealTimers();
});

// ================================================================ GET

describe('GET /api/allowances/items/[id]/rates: だれが見られるか・手当が無い', () => {
    it('ログインしていなければ 401 のまま返す。何も読まない', async () => {
        logout();
        const r = await getRates();
        expect([r.status, r.body]).toEqual([401, { error: '認証が必要です' }]);
        noReads();
    });

    it.each(OTHERS)('$role は 403「権限がありません」。何も読まない', async (user) => {
        loginAs(user);
        const r = await getRates();
        expect([r.status, r.body]).toEqual([403, { error: '権限がありません' }]);
        noReads();
    });

    it('管理者・マネージャーは見られる（DB のロールが大文字まじりでも）', async () => {
        for (const user of [ADMIN, MANAGER, { ...ADMIN, role: 'ADMIN' }, { ...MANAGER, role: 'Manager' }]) {
            loginAs(user);
            const r = await getRates();
            expect([user.role, r.status, ratesOf(r).map((x) => x.id)]).toEqual([user.role, 200, ['rate1']]);
        }
    });

    it('手当が無ければ 404「手当が見つかりません」。金額の履歴は読まない', async () => {
        const r = await getRates('missing');
        expect([r.status, r.body]).toEqual([404, { error: '手当が見つかりません' }]);
        expect(mock(prisma.allowanceItem.findUnique).mock.calls[0][0].where).toEqual({ id: 'missing' });
        expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
    });
});

describe('GET /api/allowances/items/[id]/rates: 読み方と応答', () => {
    it('その手当の行だけを、適用開始日の新しい順 → 入れた日時の新しい順 → ID の大きい順 で返す（表に入っている順によらない）', async () => {
        // 表の中は、ばらばらの順。ほかの手当の行も混ざっている
        rateRows = [
            rateRow({ id: 'b', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T01:00:00.000Z') }),
            rateRow({ id: 'far-1', itemId: 'far', effectiveFrom: utc0('2026-08-01') }),
            rateRow({ id: 'e', effectiveFrom: utc0('2026-11-01') }),
            rateRow({ id: 'a', effectiveFrom: utc0('2026-09-01') }),
            rateRow({ id: 'd', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T02:00:00.000Z') }),
            rateRow({ id: 'c', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T01:00:00.000Z') }),
        ];
        const r = await getRates();
        expect(r.status).toBe(200);
        // 11/1 → 10/1（あとから入れた d → 同じ日時の c・b は ID の大きい順）→ 9/1。遠方手当の行は出ない
        expect(ratesOf(r).map((x) => x.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
        expect(ratesOf(await getRates('far')).map((x) => x.id)).toEqual(['far-1']);

        // 渡した条件・並び
        const args = mock(prisma.allowanceRate.findMany).mock.calls[0][0] as { where: unknown; orderBy: unknown; select: Record<string, unknown> };
        expect(args.where).toEqual({ itemId: 'large' });
        expect(args.orderBy).toEqual([{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
        // 1行の形に要る列を読んでいる（入れた人の名前も）
        expect(args.select).toMatchObject({ id: true, foremanAmount: true, memberAmount: true, effectiveFrom: true, createdByName: true, createdAt: true });
    });

    it("応答は、金額の行の配列そのもの。日付は 'YYYY-MM-DD'・日時は ISO の文字。状態（予約・今の金額・以前）と、置きかえられた印（同じ適用開始日で、あとから入れた行がある）が付く。no-store", async () => {
        loginAs(MANAGER);
        rateRows = [
            firstRate(),
            // 10/1 からの金額を、打ちまちがえて（r2）、入れ直した（r3）
            rateRow({ id: 'r2', foremanAmount: 16000, memberAmount: 220, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T01:00:00.000Z') }),
            rateRow({ id: 'r3', foremanAmount: 1600, memberAmount: 220, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T02:00:00.000Z') }),
            // 明日からの予約
            rateRow({ id: 'r4', foremanAmount: 1900, memberAmount: 280, effectiveFrom: utc0('2026-10-04'), createdAt: new Date('2026-10-03T01:00:00.000Z') }),
            // 11/1 からの予約も、入れ直してある（r5 → r6）
            rateRow({ id: 'r5', foremanAmount: 2100, memberAmount: 300, effectiveFrom: utc0('2026-11-01'), createdAt: new Date('2026-10-02T01:00:00.000Z') }),
            rateRow({ id: 'r6', foremanAmount: 2000, memberAmount: 300, effectiveFrom: utc0('2026-11-01'), createdAt: new Date('2026-10-02T02:00:00.000Z') }),
        ];
        const r = await getRates();
        expect([r.status, r.cache]).toEqual([200, 'no-store']);
        expect(r.body).toEqual([
            // 適用開始日が今日（10/3）より後 → 予約。入れ直す前の行（r5）には、置きかえられた印
            { id: 'r6', foremanAmount: 2000, memberAmount: 300, effectiveFrom: '2026-11-01', createdByName: '管理者1', createdAt: '2026-10-02T02:00:00.000Z', state: 'upcoming', replaced: false },
            { id: 'r5', foremanAmount: 2100, memberAmount: 300, effectiveFrom: '2026-11-01', createdByName: '管理者1', createdAt: '2026-10-02T01:00:00.000Z', state: 'upcoming', replaced: true },
            { id: 'r4', foremanAmount: 1900, memberAmount: 280, effectiveFrom: '2026-10-04', createdByName: '管理者1', createdAt: '2026-10-03T01:00:00.000Z', state: 'upcoming', replaced: false },
            // 今日以前で、いちばん新しい適用開始日（10/1）。同じ日の2行は、あとから入れたほうが今の金額
            { id: 'r3', foremanAmount: 1600, memberAmount: 220, effectiveFrom: '2026-10-01', createdByName: '管理者1', createdAt: '2026-09-30T02:00:00.000Z', state: 'current', replaced: false },
            { id: 'r2', foremanAmount: 16000, memberAmount: 220, effectiveFrom: '2026-10-01', createdByName: '管理者1', createdAt: '2026-09-30T01:00:00.000Z', state: 'past', replaced: true },
            // 以前の金額（置きかえられたのではなく、次の適用開始日が来ただけ）
            { id: 'rate1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01', createdByName: '（最初の設定）', createdAt: '2026-08-25T01:02:03.456Z', state: 'past', replaced: false },
        ]);
        noWrites();
    });

    it('金額の行が1つも無い手当は、空の配列', async () => {
        const r = await getRates('far');
        expect([r.status, r.body]).toEqual([200, []]);
    });

    it('今日ちょうどから始まる行は「今の金額」（予約ではない）。それまでの行は「以前」になる', async () => {
        rateRows = [
            rateRow({ id: 'tomorrow', effectiveFrom: utc0('2026-10-04') }),
            rateRow({ id: 'today', effectiveFrom: utc0('2026-10-03') }),
            rateRow({ id: 'old', effectiveFrom: utc0('2026-09-01') }),
        ];
        expect(marksOf(await getRates())).toEqual([['tomorrow', 'upcoming', false], ['today', 'current', false], ['old', 'past', false]]);
    });

    it('今日が始まりの日より前（どの適用開始日も、今日より後）なら、「今の金額」の行は無い（全部が予約）', async () => {
        rateRows = [rateRow({ id: 'second', effectiveFrom: utc0('2026-12-01') }), rateRow({ id: 'first', effectiveFrom: utc0('2026-11-01') })];
        expect(statesOf(await getRates())).toEqual({ second: 'upcoming', first: 'upcoming' });
    });

    it('同じ適用開始日の行は、いちばんあとから入れた1行だけが使われる。入れた日時まで同じなら、ID の大きいほう（ほかの行には、置きかえられた印）', async () => {
        // 入れた日時が同じ2行: ID の大きい b が使われる
        rateRows = [
            rateRow({ id: 'b', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T01:00:00.000Z') }),
            rateRow({ id: 'a', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T01:00:00.000Z') }),
        ];
        expect(marksOf(await getRates())).toEqual([['b', 'current', false], ['a', 'past', true]]);

        // 入れた日時が違えば、ID の大小によらず、あとから入れたほう
        rateRows = [
            rateRow({ id: 'a', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T02:00:00.000Z') }),
            rateRow({ id: 'b', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T01:00:00.000Z') }),
        ];
        expect(marksOf(await getRates())).toEqual([['a', 'current', false], ['b', 'past', true]]);

        // 3行あれば、いちばんあとの1行だけに印が付かない
        rateRows = [
            rateRow({ id: 'x', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T01:00:00.000Z') }),
            rateRow({ id: 'y', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T03:00:00.000Z') }),
            rateRow({ id: 'z', effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-30T02:00:00.000Z') }),
        ];
        expect(marksOf(await getRates())).toEqual([['y', 'current', false], ['z', 'past', true], ['x', 'past', true]]);
    });

    it('状態の「今日」は日本時間で決まる（UTC ではまだ前の日でも、日本時間で日付が変わっていれば、その日から始まる行が今の金額）', async () => {
        rateRows = [rateRow({ id: 'oct3', effectiveFrom: utc0('2026-10-03') }), rateRow({ id: 'sep1', effectiveFrom: utc0('2026-09-01') })];

        freezeNow('2026-10-02T14:59:59.999Z'); // 日本時間 10/2 23:59（まだ 10/2）
        expect(statesOf(await getRates())).toEqual({ oct3: 'upcoming', sep1: 'current' });

        freezeNow('2026-10-02T15:00:00.000Z'); // 日本時間 10/3 0:00（UTC ではまだ 10/2）
        expect(statesOf(await getRates())).toEqual({ oct3: 'current', sep1: 'past' });
    });
});

// ================================================================ POST

describe('POST /api/allowances/items/[id]/rates: だれが変えられるか（管理者だけ）', () => {
    it('ログインしていなければ 401 のまま返す。何も読まず、何も書かない', async () => {
        logout();
        const r = await postRate(VALID);
        expect([r.status, r.body]).toEqual([401, { error: '認証が必要です' }]);
        noReads();
        noWrites();
    });

    it.each([MANAGER, ...OTHERS])('$role は 403「権限がありません」（マネージャーも変えられない）。何も読まず、何も書かない', async (user) => {
        loginAs(user);
        const r = await postRate(VALID);
        expect([r.status, r.body]).toEqual([403, { error: '権限がありません' }]);
        noReads();
        noWrites();
    });

    it('DB のロールが大文字（ADMIN）でも、管理者として扱う', async () => {
        loginAs({ ...ADMIN, role: 'ADMIN' });
        expect((await postRate(VALID)).status).toBe(201);
    });
});

describe('POST /api/allowances/items/[id]/rates: 入力の形（合わなければ 400。トランザクションを開かず、鍵も取らず、何も読まない・書かない）', () => {
    /** [どんな入力か, 返る応答, body] */
    const BAD_BODIES: [string, { error: string; details: string }, unknown][] = [
        ['body が無い', INVALID_INPUT, undefined],
        ['JSON として読めない', INVALID_INPUT, 'JSON ではない'],
        ['配列', INVALID_INPUT, [VALID]],
        ['null', INVALID_INPUT, null],
        ['何も入っていない', INVALID_INPUT, {}],
        ['適用開始日が無い', INVALID_INPUT, { foremanAmount: 1800, memberAmount: 250 }],
        ['適用開始日が数', INVALID_INPUT, { ...VALID, effectiveFrom: 20261010 }],
        ['適用開始日が null', INVALID_INPUT, { ...VALID, effectiveFrom: null }],
        // 金額の形が違うときは、金額の文言
        ['職長の金額が -1', INVALID_AMOUNT, { ...VALID, foremanAmount: -1 }],
        ['職長の金額が 100001', INVALID_AMOUNT, { ...VALID, foremanAmount: 100001 }],
        ['職長の金額が 1.5', INVALID_AMOUNT, { ...VALID, foremanAmount: 1.5 }],
        ["職長の金額が '200'（文字）", INVALID_AMOUNT, { ...VALID, foremanAmount: '200' }],
        ['職長の金額が無い', INVALID_AMOUNT, { memberAmount: 250, effectiveFrom: '2026-10-10' }],
        ['職長の金額が null', INVALID_AMOUNT, { ...VALID, foremanAmount: null }],
        ['職長の金額が true', INVALID_AMOUNT, { ...VALID, foremanAmount: true }],
        ['職長の金額が大きすぎて数にならない（1e400）', INVALID_AMOUNT, '{"foremanAmount":1e400,"memberAmount":250,"effectiveFrom":"2026-10-10"}'],
        ['職長以外の金額が -1', INVALID_AMOUNT, { ...VALID, memberAmount: -1 }],
        ['職長以外の金額が 100001', INVALID_AMOUNT, { ...VALID, memberAmount: 100001 }],
        ['職長以外の金額が 1.5', INVALID_AMOUNT, { ...VALID, memberAmount: 1.5 }],
        ["職長以外の金額が '200'（文字）", INVALID_AMOUNT, { ...VALID, memberAmount: '200' }],
        ['職長以外の金額が無い', INVALID_AMOUNT, { foremanAmount: 1800, effectiveFrom: '2026-10-10' }],
        ['職長以外の金額が null', INVALID_AMOUNT, { ...VALID, memberAmount: null }],
        // 金額を1つだけ（points）で送る、評価ポイントの形は通らない
        ['評価ポイントの形（points）', INVALID_AMOUNT, { points: 3, effectiveFrom: '2026-10-10' }],
        // 2つ以上違うとき: 適用開始日が文字かどうか →（金額）→（日付の形）の順に見て、最初に当たった文言を返す
        ['適用開始日が無く、金額の形も違う（「入力が不正です」が先）', INVALID_INPUT, { foremanAmount: -1, memberAmount: 250 }],
        ['金額も、日付の形も違う（金額の文言が先）', INVALID_AMOUNT, { foremanAmount: -1, memberAmount: 250, effectiveFrom: '2026-02-30' }],
    ];

    it.each(BAD_BODIES)('%s → 400', async (_label, expected, body) => {
        const r = await postRate(body);
        expect([r.status, r.body]).toEqual([400, expected]);
        noReads();
        noWrites();
    });

    it('日付の形が違う・実在しない日付 → 400「日付が不正です」（過去に見える文字でも、先に見える文字でも）', async () => {
        for (const effectiveFrom of ['2026-02-30', '2099-02-30', '2026-13-01', '2026/10/10', '', '2026-10-1', '20261010', ' 2026-10-10', '2026-10-10T00:00:00.000Z', '10/10/2026', 'あした']) {
            const r = await postRate({ ...VALID, effectiveFrom });
            expect([effectiveFrom, r.status, r.body]).toEqual([effectiveFrom, 400, INVALID_DATE]);
        }
        noReads();
        noWrites();
    });
});

describe('POST /api/allowances/items/[id]/rates: いつの適用開始日なら足せるか', () => {
    it('今日・先の日付（遠い先も）は足せる', async () => {
        for (const effectiveFrom of ['2026-10-03', '2026-10-04', '2027-01-01', '2099-12-31']) {
            const r = await postRate({ ...VALID, effectiveFrom });
            expect([effectiveFrom, r.status, r.body.rate?.effectiveFrom]).toEqual([effectiveFrom, 201, effectiveFrom]);
        }
    });

    it('過去の日付でも、手当の始まりの日（いちばん古い適用開始日）からあとなら足せる（始まりの日の当日・きのうも）', async () => {
        // 始まりの日は 9/1。今日は 10/3
        for (const effectiveFrom of ['2026-09-01', '2026-09-15', '2026-10-02']) {
            const r = await postRate({ ...VALID, effectiveFrom });
            expect([effectiveFrom, r.status, r.body.rate?.effectiveFrom]).toEqual([effectiveFrom, 201, effectiveFrom]);
        }
    });

    it('過去の日付で、始まりの日より前 → 400「適用開始日は、手当の始まりの日（◯）以降にしてください」。何も書かない', async () => {
        for (const effectiveFrom of ['2026-08-31', '2026-08-01', '2025-12-31', '2000-01-01']) {
            const r = await postRate({ ...VALID, effectiveFrom });
            expect([effectiveFrom, r.status, r.body]).toEqual([effectiveFrom, 400, beforeStart('2026-09-01')]);
        }
        nothingWritten();
        expect(rateTable()).toEqual([['rate1', '2026-09-01', 1500, 200]]);
        // 断るのは、鍵を取って、金額の履歴を読んだあと（読むのは、どれも tx を通す）
        expect(transactionOutcomes).toEqual(['done', 'done', 'done', 'done']);
        expect(callsOutsideTx()).toEqual({});
    });

    it('始まりの日は、いちばん古い適用開始日（あとから、さかのぼって足した行の日付も入れて決まる）', async () => {
        rateRows = [secondRate(), rateRow({ id: 'rate0', effectiveFrom: utc0('2026-09-10'), createdAt: new Date('2026-10-01T00:00:00.000Z') })];
        const before = await postRate({ ...VALID, effectiveFrom: '2026-09-09' });
        expect([before.status, before.body]).toEqual([400, beforeStart('2026-09-10')]);
        expect((await postRate({ ...VALID, effectiveFrom: '2026-09-10' })).status).toBe(201);
    });

    it('金額の行が1つも無い手当: 過去の日付は 400「適用開始日は、今日以降にしてください」。今日からなら足せる', async () => {
        const past = await postRate({ ...VALID, effectiveFrom: '2026-10-02' }, 'far');
        expect([past.status, past.body]).toEqual([400, NO_START]);
        nothingWritten();

        const today = await postRate({ ...VALID, effectiveFrom: '2026-10-03' }, 'far');
        expect([today.status, today.body.rate?.state]).toEqual([201, 'current']);
    });

    it('予約しか無い手当（始まりの日が先）: 過去の日付は足せない（文言に出るのは、先にある始まりの日）。今日・先の日付なら、始まりの日より前でも足せる', async () => {
        rateRows = [rateRow({ id: 'nov', effectiveFrom: utc0('2026-11-01') })];
        // きのう（10/2）は断る。文言は「始まりの日（11/1）以降」だが、実際には、今日（10/3）からあとなら足せる
        const past = await postRate({ ...VALID, effectiveFrom: '2026-10-02' });
        expect([past.status, past.body]).toEqual([400, beforeStart('2026-11-01')]);
        nothingWritten();

        expect((await postRate({ ...VALID, effectiveFrom: '2026-10-20' })).status).toBe(201);
        expect((await postRate({ ...VALID, effectiveFrom: '2026-10-03' })).status).toBe(201);
    });

    it('適用開始日の月からあとに、締めた月が1つでもある → 400「◯ は締めてあります。締めを外してから、金額を変えてください」（文言には、その中でいちばん古い月）。何も書かない', async () => {
        closedMonths = ['2026-09'];
        const sameMonth = await postRate({ ...VALID, effectiveFrom: '2026-09-15' });
        expect([sameMonth.status, sameMonth.body]).toEqual([400, closedMonth('2026-09')]);

        // 締めた月が2つ（9月・10月）: いちばん古い 9月を伝える（表に入っている順によらない）
        closedMonths = ['2026-10', '2026-09'];
        const two = await postRate({ ...VALID, effectiveFrom: '2026-09-01' });
        expect([two.status, two.body]).toEqual([400, closedMonth('2026-09')]);

        // 適用開始日の月（9月）は締めていなくても、あとの月（10月）を締めていれば断る
        closedMonths = ['2026-10', '2026-08'];
        const later = await postRate({ ...VALID, effectiveFrom: '2026-09-15' });
        expect([later.status, later.body]).toEqual([400, closedMonth('2026-10')]);

        // 今日・先の日付でも同じ
        closedMonths = ['2026-12'];
        const future = await postRate({ ...VALID, effectiveFrom: '2026-11-01' });
        expect([future.status, future.body]).toEqual([400, closedMonth('2026-12')]);
        const today = await postRate({ ...VALID, effectiveFrom: '2026-10-03' });
        expect([today.status, today.body]).toEqual([400, closedMonth('2026-12')]);

        nothingWritten();
        expect(rateTable()).toEqual([['rate1', '2026-09-01', 1500, 200]]);
    });

    it('適用開始日の月より前の月だけが締めてあるなら、足せる（締めた月は「適用開始日の月からあと」だけを、tx で読む）', async () => {
        closedMonths = ['2026-08', '2026-07'];
        const r = await postRate({ ...VALID, effectiveFrom: '2026-09-15' });
        expect(r.status).toBe(201);
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledWith({ where: { month: { gte: '2026-09' } }, select: { month: true } });
        expect(txCalls).toContain('allowanceMonthClose.findMany');
    });

    it('始まりの日より前で、締めた月もあるときは、始まりの日の文言（始まりの日のほうを先に見る）', async () => {
        closedMonths = ['2026-08', '2026-09'];
        const r = await postRate({ ...VALID, effectiveFrom: '2026-08-15' });
        expect([r.status, r.body]).toEqual([400, beforeStart('2026-09-01')]);
        nothingWritten();
    });

    it('「今日」は日本時間で決まる（UTC ではまだ前の日でも、日本の日付が今日なら、前の日は過去）', async () => {
        // 金額の行が1つも無い手当（遠方手当）は、過去の日付は足せない・今日からは足せる
        freezeNow('2026-10-02T15:30:00.000Z'); // 日本時間 10/3 0:30（UTC ではまだ 10/2）
        const past = await postRate({ ...VALID, effectiveFrom: '2026-10-02' }, 'far');
        expect([past.status, past.body]).toEqual([400, NO_START]);
        const today = await postRate({ ...VALID, effectiveFrom: '2026-10-03' }, 'far');
        expect([today.status, today.body.rate?.state]).toEqual([201, 'current']);

        // 日本時間で日付が変わる直前（10/2 23:59）なら、10/2 はまだ今日
        rateRows = [];
        freezeNow('2026-10-02T14:59:59.999Z');
        const stillToday = await postRate({ ...VALID, effectiveFrom: '2026-10-02' }, 'far');
        expect([stillToday.status, stillToday.body.rate?.state]).toEqual([201, 'current']);
    });

    it('「今日」と「入れた日時」は、鍵を取ったあとで決める（鍵を待っているあいだに日付が変わったら、変わったあとの日で判定する）', async () => {
        freezeNow('2026-10-03T14:59:59.900Z'); // 日本時間 10/3 23:59:59.900
        const dayChanges = () => whileWaitingForLock(() => jest.setSystemTime(new Date('2026-10-03T15:00:00.100Z'))); // 待っているあいだに、日本時間で 10/4 になる

        // 呼んだときは「今日」だった 10/3 が、鍵のあとでは「過去の日付」（金額の行が無い遠方手当には、足せない）
        dayChanges();
        const past = await postRate({ ...VALID, effectiveFrom: '2026-10-03' }, 'far');
        expect([past.status, past.body]).toEqual([400, NO_START]);
        nothingWritten();

        // 呼んだときは「明日」だった 10/4 は、鍵のあとでは「今日」＝足した行は、予約ではなく、今の金額
        freezeNow('2026-10-03T14:59:59.900Z');
        dayChanges();
        const today = await postRate({ ...VALID, effectiveFrom: '2026-10-04' }, 'far');
        expect([today.status, today.body.rate?.state, today.body.rate?.createdAt]).toEqual([201, 'current', '2026-10-03T15:00:00.100Z']);
    });

    it('手当が無ければ 404「手当が見つかりません」。鍵を取って、手当を読むだけ（何も書かない）', async () => {
        const r = await postRate(VALID, 'missing');
        expect([r.status, r.body]).toEqual([404, { error: '手当が見つかりません' }]);
        expect(mock(prisma.allowanceItem.findUnique).mock.calls[0][0].where).toEqual({ id: 'missing' });
        expect(txCalls).toEqual(['$executeRaw', 'allowanceItem.findUnique']);
        nothingWritten();
    });
});

describe('POST /api/allowances/items/[id]/rates: 行を足す・履歴・応答', () => {
    it('金額の行を足して、履歴（rate_added）を書く。応答は 201 { rate（状態・置きかえられた印つき）, repriced }。no-store', async () => {
        const r = await postRate(VALID);
        expect([r.status, r.cache]).toEqual([201, 'no-store']);

        expect(prisma.allowanceRate.create).toHaveBeenCalledTimes(1);
        // 適用開始日は、UTC 0時の Date（@db.Date の列に入れる形）。入れた日時は、今
        expect(createData()).toEqual({
            itemId: 'large', foremanAmount: 1800, memberAmount: 250, effectiveFrom: utc0('2026-10-10'),
            createdBy: 'admin1', createdByName: '管理者1', createdAt: new Date(NOON),
        });
        expect(createData().effectiveFrom).toBeInstanceOf(Date);
        expect(rateTable()).toEqual([['rate1', '2026-09-01', 1500, 200], ['added-1', '2026-10-10', 1800, 250]]);

        // 履歴は rate_added の1行だけ（足した行の ID・金額・適用開始日・金額が変わった記録の件数）
        expect(logs).toEqual([{
            action: 'rate_added', actorId: 'admin1', actorName: '管理者1', itemId: 'large',
            detail: { rateId: 'added-1', foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-10-10', repriced: 0 },
        }]);

        expect(r.body).toEqual({
            rate: {
                id: 'added-1', foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-10-10',
                createdByName: '管理者1', createdAt: '2026-10-03T03:00:00.000Z', state: 'upcoming', replaced: false,
            },
            repriced: 0,
        });
    });

    it('全部の読み書きが、1つのトランザクションの中（tx）: 鍵 → 手当 → 金額の履歴 → 締めた月 → 行を足す → 記録を読む → 履歴 の順', async () => {
        expect((await postRate(VALID)).status).toBe(201);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(txCalls).toEqual([
            '$executeRaw', 'allowanceItem.findUnique', 'allowanceRate.findMany', 'allowanceMonthClose.findMany',
            'allowanceRate.create', 'allowanceRecord.findMany', 'allowanceLog.create',
        ]);
        expect(transactionOutcomes).toEqual(['done']);
        // tx の外（prisma を直接）では、何も読み書きしていない
        expect(callsOutsideTx()).toEqual({});
        // 鍵は1回だけ。記録を足す・月を締める・手当を直す などと同じ鍵
        expect(lockSqls()).toEqual([LOCK_SQL]);
        // トランザクションの設定: DB の接続の空きを待つのは5秒まで・トランザクションの全体は10秒まで（鍵を待つ時間も全体に入るので、既定の5秒より長い）
        expect(transactionOptions()).toEqual([{ maxWait: 5000, timeout: 10000 }]);
    });

    it('応答の状態: 今日からの行は current・明日からは upcoming。過去の日付で足した行は、今の金額になれば current・あとの適用開始日の行に隠れていれば past', async () => {
        // 9/1 からの行だけがある
        expect((await postRate({ ...VALID, effectiveFrom: '2026-10-03' })).body.rate).toMatchObject({ state: 'current', replaced: false });
        expect((await postRate({ ...VALID, effectiveFrom: '2026-10-04' })).body.rate).toMatchObject({ state: 'upcoming', replaced: false });

        // 9/1・10/1 からの行がある: 9/15 から足した行は、10/1 からの行に隠れて「以前」
        rateRows = [firstRate(), secondRate()];
        expect((await postRate({ ...VALID, effectiveFrom: '2026-09-15' })).body.rate).toMatchObject({ state: 'past', replaced: false });
        // 10/2 から足した行は、今日（10/3）の金額になる
        expect((await postRate({ ...VALID, effectiveFrom: '2026-10-02' })).body.rate).toMatchObject({ state: 'current', replaced: false });
    });

    it('URL の手当に足す（ほかの手当の ID なら、その手当に）。職長と職長以外の金額を取り違えない', async () => {
        const r = await postRate({ foremanAmount: 1200, memberAmount: 150, effectiveFrom: '2026-10-10' }, 'far');
        expect(r.status).toBe(201);
        expect(createData()).toMatchObject({ itemId: 'far', foremanAmount: 1200, memberAmount: 150 });
        expect(logs[0]).toMatchObject({ itemId: 'far', detail: { foremanAmount: 1200, memberAmount: 150, effectiveFrom: '2026-10-10' } });
        expect(r.body.rate).toMatchObject({ foremanAmount: 1200, memberAmount: 150 });
        // 大規模手当の履歴には出ない
        expect(ratesOf(await getRates()).map((x) => x.id)).toEqual(['rate1']);
        expect(ratesOf(await getRates('far')).map((x) => x.id)).toEqual(['added-1']);
    });

    it('0円も入れられる（金額の両端 0・100000 は通る）', async () => {
        const zero = await postRate({ foremanAmount: 0, memberAmount: 0, effectiveFrom: '2026-10-10' });
        expect([zero.status, zero.body.rate?.foremanAmount, zero.body.rate?.memberAmount]).toEqual([201, 0, 0]);
        expect(createData()).toMatchObject({ foremanAmount: 0, memberAmount: 0 });

        const max = await postRate({ foremanAmount: 100000, memberAmount: 100000, effectiveFrom: '2026-10-11' });
        expect([max.status, max.body.rate?.foremanAmount, max.body.rate?.memberAmount]).toEqual([201, 100000, 100000]);
        expect(createData()).toMatchObject({ foremanAmount: 100000, memberAmount: 100000 });
    });

    it('入れた人として、ログインしている人の ID と名前を残す。名前の無い session では、ログイン名を写す', async () => {
        loginAs({ id: 'admin2', role: 'admin' });
        const r = await postRate(VALID);
        expect(r.status).toBe(201);
        expect(createData()).toMatchObject({ createdBy: 'admin2', createdByName: 'login-admin2' });
        expect(logs[0]).toMatchObject({ actorId: 'admin2', actorName: 'login-admin2' });
        expect(r.body.rate?.createdByName).toBe('login-admin2');
    });
});

describe('POST /api/allowances/items/[id]/rates: 同じ適用開始日で入れ直す（打ちまちがいの直し）', () => {
    it('追記だけ: 同じ適用開始日の行がすでにあっても、断らず、直さず・消さずに、行を足す（金額の表への書き込みは create の1回だけ）', async () => {
        rateRows = [firstRate(), rateRow({ id: 'same-day' })]; // 10/10 からの予約が、すでにある
        const r = await postRate({ ...VALID, foremanAmount: 1900 });
        expect(r.status).toBe(201);
        expect(writesOf(prisma.allowanceRate)).toEqual({ create: 1 });
        // 前の行は、そのまま残る
        expect(rateTable()).toEqual([['rate1', '2026-09-01', 1500, 200], ['same-day', '2026-10-10', 1800, 250], ['added-1', '2026-10-10', 1900, 250]]);
        // 手当の行には触らない
        expect(writesOf(prisma.allowanceItem)).toEqual({});
    });

    it('足す行の入れた日時は、同じ適用開始日の行より、必ずあとになる（時計が同じミリ秒でも・その行の日時が今より先でも）', async () => {
        /** 10/10 からの行を1つ足したときの、足した行の入れた日時 */
        const addedAt = async (existing: RateRow[]) => {
            rateRows = [firstRate(), ...existing];
            const r = await postRate(VALID);
            expect(r.status).toBe(201);
            // 足した行が「あとから入れた行」＝置きかえられた印は、付かない
            expect(r.body.rate).toMatchObject({ replaced: false, createdAt: (createData().createdAt as Date).toISOString() });
            return r.body.rate?.createdAt;
        };
        // もとからある行の ID（rate-…）は、足す行の ID（added-…）より大きい文字（入れた日時が同じだと、もとの行のほうが使われてしまう）
        const sameDay = (id: string, createdAt: string) => rateRow({ id, createdAt: new Date(createdAt) });

        // 同じ適用開始日の行が無い（ほかの適用開始日の行が、今より先の日時で入っていても）→ 今
        expect(await addedAt([rateRow({ id: 'rate-other', effectiveFrom: utc0('2026-10-11'), createdAt: new Date('2026-10-03T05:00:00.000Z') })])).toBe('2026-10-03T03:00:00.000Z');
        // 同じ適用開始日の行が、今より前に入っている → 今
        expect(await addedAt([sameDay('rate-old', '2026-10-02T01:00:00.000Z')])).toBe('2026-10-03T03:00:00.000Z');
        // 同じ適用開始日の行が、今と同じミリ秒に入っている → その1ミリ秒あと
        expect(await addedAt([sameDay('rate-old', NOON)])).toBe('2026-10-03T03:00:00.001Z');
        // 同じ適用開始日の行が2つ（今と同じ・今の10ミリ秒あと）→ いちばんあとの行の、1ミリ秒あと
        expect(await addedAt([sameDay('rate-old1', NOON), sameDay('rate-old2', '2026-10-03T03:00:00.010Z')])).toBe('2026-10-03T03:00:00.011Z');
    });

    it('時計が進まないまま（同じミリ秒に）続けて3回入れ直しても、いちばんあとに入れた行が使われる', async () => {
        await postRate({ foremanAmount: 1, memberAmount: 1, effectiveFrom: '2026-10-01' });
        await postRate({ foremanAmount: 2, memberAmount: 2, effectiveFrom: '2026-10-01' });
        const third = await postRate({ foremanAmount: 3, memberAmount: 3, effectiveFrom: '2026-10-01' });
        expect(third.body.rate).toMatchObject({ id: 'added-3', state: 'current', replaced: false, createdAt: '2026-10-03T03:00:00.002Z' });
        expect(marksOf(await getRates())).toEqual([
            ['added-3', 'current', false], ['added-2', 'past', true], ['added-1', 'past', true], ['rate1', 'past', false],
        ]);
    });

    it('今の金額を、同じ適用開始日で入れ直すと、入れ直した行が「今の金額」になり、古い行には「置きかえられた」の印が付く', async () => {
        rateRows = [firstRate(), secondRate({ foremanAmount: 20000 })]; // 10/1 からの職長の金額を、まちがえて 20,000円で入れていた
        const r = await postRate({ foremanAmount: 2000, memberAmount: 300, effectiveFrom: '2026-10-01' });
        expect([r.status, r.body.rate?.state, r.body.rate?.replaced]).toEqual([201, 'current', false]);
        expect(marksOf(await getRates())).toEqual([['added-1', 'current', false], ['rate2', 'past', true], ['rate1', 'past', false]]);
    });
});

describe('POST /api/allowances/items/[id]/rates: 過去・今日の適用開始日で足すと、その日からあとの記録が、新しい金額になる', () => {
    /** 9/15 から、職長 1,800円・職長以外 250円（9/1 からは 1,500円・200円、10/1 からは 2,000円・300円） */
    const backdate = (over: Record<string, unknown> = {}) => postRate({ foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-09-15', ...over });

    beforeEach(() => {
        rateRows = [firstRate(), secondRate()];
        recordRows = [
            recordRow('g', 'worker1', '2026-09-14', 'member', 200, 'rate1'),    // 適用開始日の前の日 → 変わらない
            recordRow('f', 'worker2', '2026-09-15', 'member', 200, 'rate1'),    // 適用開始日の当日 → 変わる
            recordRow('a', 'foremanA', '2026-09-20', 'foreman', 1500, 'rate1'),
            recordRow('b', 'worker1', '2026-09-20', 'member', 200, 'rate1'),
            // 次の金額（10/1 から）が始まる前の日。手当の名前は、付けたときの名前のまま写してある
            recordRow('c', 'foremanA', '2026-09-30', 'foreman', 1500, 'rate1', { itemName: '大規模手当（旧名）' }),
            recordRow('d', 'worker1', '2026-10-01', 'member', 300, 'rate2'),    // 10/1 からの金額の区間 → 変わらない
            recordRow('e', 'foremanA', '2026-10-02', 'foreman', 2000, 'rate2'),
            // ほかの手当（遠方手当）の記録 → 変わらない
            recordRow('h', 'worker1', '2026-09-20', 'member', 100, 'far-rate1', { itemId: 'far', itemName: '遠方手当' }),
        ];
    });

    it('職長の記録は職長の金額に、職長以外の記録は職長以外の金額になる。適用開始日より前・あとの適用開始日の行がある区間・ほかの手当の記録は、変わらない', async () => {
        const r = await backdate();
        expect([r.status, r.body.repriced]).toEqual([201, 4]);
        expect(recordAmounts()).toEqual({
            g: [200, 'rate1'],
            f: [250, 'added-1'],
            a: [1800, 'added-1'],
            b: [250, 'added-1'],
            c: [1800, 'added-1'],
            d: [300, 'rate2'],
            e: [2000, 'rate2'],
            h: [100, 'far-rate1'],
        });
        // 足した行そのものは、10/1 からの行に隠れているので「以前」
        expect(r.body.rate).toMatchObject({ id: 'added-1', effectiveFrom: '2026-09-15', state: 'past', replaced: false });
    });

    it('読む記録は「その手当の、適用開始日（UTC 0時）からあと」。直すのは、金額と「どの金額の行から写したか」だけ（合わせたあとの値が同じ記録は、まとめて1回で直す）', async () => {
        await backdate();
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(mock(prisma.allowanceRecord.findMany).mock.calls[0][0].where).toEqual({ itemId: 'large', date: { gte: utc0('2026-09-15') } });
        expect(mock(prisma.allowanceRecord.updateMany).mock.calls.map((c) => c[0] as unknown)).toEqual([
            { where: { id: { in: ['f', 'b'] } }, data: { amount: 250, rateId: 'added-1' } },
            { where: { id: { in: ['a', 'c'] } }, data: { amount: 1800, rateId: 'added-1' } },
        ]);
        // 記録を足したり消したりはしない
        expect(writesOf(prisma.allowanceRecord)).toEqual({ updateMany: 2 });
    });

    it('履歴: rate_added（金額が変わった件数つき）を1行と、金額が変わった記録ごとに record_repriced（変わる前と後の金額）を1行。件数は、応答の repriced と同じ', async () => {
        const r = await backdate();
        const repriced = (recordId: string, targetUserId: string, dateKey: string, detail: Record<string, unknown>) => ({
            action: 'record_repriced', actorId: 'admin1', actorName: '管理者1',
            targetUserId, itemId: 'large', recordId, recordDate: utc0(dateKey), detail: { ...detail, rateId: 'added-1' },
        });
        expect(logs).toEqual([
            {
                action: 'rate_added', actorId: 'admin1', actorName: '管理者1', itemId: 'large',
                detail: { rateId: 'added-1', foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-09-15', repriced: 4 },
            },
            repriced('f', 'worker2', '2026-09-15', { itemName: '大規模手当', payRole: 'member', before: 200, after: 250 }),
            repriced('a', 'foremanA', '2026-09-20', { itemName: '大規模手当', payRole: 'foreman', before: 1500, after: 1800 }),
            repriced('b', 'worker1', '2026-09-20', { itemName: '大規模手当', payRole: 'member', before: 200, after: 250 }),
            // 手当の名前は、記録に写してある名前
            repriced('c', 'foremanA', '2026-09-30', { itemName: '大規模手当（旧名）', payRole: 'foreman', before: 1500, after: 1800 }),
        ]);
        expect(logs.filter((l) => l.action === 'record_repriced')).toHaveLength(r.body.repriced ?? -1);
        // 履歴の書き込みは、rate_added の1回と、record_repriced をまとめた1回
        expect(writesOf(prisma.allowanceLog)).toEqual({ create: 1, createMany: 1 });
    });

    it('金額が同じで「どの金額の行から写したか」だけが変わる記録は、行を付け替えるだけ（repriced に数えない・record_repriced も書かない）', async () => {
        // 職長だけ 1,800円にする（職長以外は 200円のまま）
        const r = await backdate({ memberAmount: 200 });
        expect([r.status, r.body.repriced]).toEqual([201, 2]);
        expect(recordAmounts()).toMatchObject({
            f: [200, 'added-1'], b: [200, 'added-1'],     // 金額は同じ。写した行だけが、足した行になる
            a: [1800, 'added-1'], c: [1800, 'added-1'],   // 金額が変わる
        });
        expect(logs.map((l) => [l.action, l.recordId ?? null])).toEqual([['rate_added', null], ['record_repriced', 'a'], ['record_repriced', 'c']]);
        expect(logs[0].detail).toMatchObject({ repriced: 2 });
    });

    it('合わせる先は、記録の日付ごとに決まる: 金額の表と合っていない記録が、あとの適用開始日の行がある区間にあれば、その区間の行の金額に合わせる。適用開始日より前の記録は、合っていなくても触らない', async () => {
        // DB を直に書きかえない限り、こうはならない（金額だけが、金額の表と違う記録）
        recordRows = [
            // 適用開始日（9/15）より前: 9/1 からの金額（200円）と合っていないが、読まない・直さない
            recordRow('early', 'worker1', '2026-09-10', 'member', 999, 'rate1'),
            recordRow('b', 'worker1', '2026-09-20', 'member', 200, 'rate1'),
            // 10/1 からの金額の区間: 写した行（rate2）は合っているが、金額だけが 300円と違う
            recordRow('odd', 'worker2', '2026-10-01', 'member', 999, 'rate2'),
            recordRow('d', 'worker1', '2026-10-01', 'member', 300, 'rate2'),
        ];
        // 9/15 から、職長 1,800円・職長以外 300円（職長以外は、10/1 からの金額と同じ金額）
        const r = await backdate({ memberAmount: 300 });
        expect([r.status, r.body.repriced]).toEqual([201, 2]);
        expect(recordAmounts()).toEqual({
            early: [999, 'rate1'],
            b: [300, 'added-1'],
            // 金額は同じ 300円でも、写した行は、その日付の行（10/1 からの行）。足した行にはしない
            odd: [300, 'rate2'],
            d: [300, 'rate2'],
        });
        expect(logs.filter((l) => l.action === 'record_repriced').map((l) => [l.recordId, l.detail])).toEqual([
            ['b', { itemName: '大規模手当', payRole: 'member', before: 200, after: 300, rateId: 'added-1' }],
            ['odd', { itemName: '大規模手当', payRole: 'member', before: 999, after: 300, rateId: 'rate2' }],
        ]);
    });

    it('金額が変わる記録が1件も無ければ、record_repriced は書かない（repriced は 0）', async () => {
        // 9/1 からの金額と同じ金額を、9/15 から入れる
        const r = await backdate({ foremanAmount: 1500, memberAmount: 200 });
        expect([r.status, r.body.repriced]).toEqual([201, 0]);
        expect(recordAmounts()).toMatchObject({ g: [200, 'rate1'], f: [200, 'added-1'], a: [1500, 'added-1'], b: [200, 'added-1'], c: [1500, 'added-1'] });
        expect(logs.map((l) => l.action)).toEqual(['rate_added']);
        expect(logs[0].detail).toMatchObject({ repriced: 0 });
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
    });

    it('今日を適用開始日にしたときも、今日の記録は新しい金額になる（きのうまでの記録は変わらない）', async () => {
        recordRows = [
            recordRow('x', 'foremanA', '2026-10-02', 'foreman', 2000, 'rate2'),
            recordRow('y', 'foremanA', '2026-10-03', 'foreman', 2000, 'rate2'),
            recordRow('z', 'worker1', '2026-10-03', 'member', 300, 'rate2'),
        ];
        const r = await postRate({ foremanAmount: 2200, memberAmount: 350, effectiveFrom: '2026-10-03' });
        expect([r.status, r.body.repriced, r.body.rate?.state]).toEqual([201, 2, 'current']);
        expect(recordAmounts()).toEqual({ x: [2000, 'rate2'], y: [2200, 'added-1'], z: [350, 'added-1'] });
    });

    it('打ちまちがいの直し: すでにある行と同じ適用開始日で入れ直すと、その日からあとの記録が、入れ直した金額になる', async () => {
        // 10/1 からの職長の金額を、まちがえて 20,000円で入れていた。10/2 の職長の記録は、その金額で付いている
        rateRows = [firstRate(), secondRate({ foremanAmount: 20000 })];
        recordRows = [
            recordRow('c', 'foremanA', '2026-09-30', 'foreman', 1500, 'rate1'),
            recordRow('d', 'worker1', '2026-10-01', 'member', 300, 'rate2'),
            recordRow('e', 'foremanA', '2026-10-02', 'foreman', 20000, 'rate2'),
        ];
        const r = await postRate({ foremanAmount: 2000, memberAmount: 300, effectiveFrom: '2026-10-01' });
        expect([r.status, r.body.repriced]).toEqual([201, 1]);
        expect(recordAmounts()).toEqual({ c: [1500, 'rate1'], d: [300, 'added-1'], e: [2000, 'added-1'] });
        expect(logs.filter((l) => l.action === 'record_repriced').map((l) => [l.recordId, l.detail])).toEqual([
            ['e', { itemName: '大規模手当', payRole: 'foreman', before: 20000, after: 2000, rateId: 'added-1' }],
        ]);
    });

    it('先の日付（予約）を足しても、記録は1件も変わらない（その日からあとの記録は、まだ無い）', async () => {
        const before = recordAmounts();
        const r = await postRate(VALID); // 10/10 から
        expect([r.status, r.body.repriced]).toEqual([201, 0]);
        expect(recordAmounts()).toEqual(before);
        expect(writesOf(prisma.allowanceRecord)).toEqual({});
        expect(logs.map((l) => l.action)).toEqual(['rate_added']);
    });

    it('締めた月があって断られたとき・始まりの日より前で断られたときは、金額の行も記録も変わらない', async () => {
        const before = recordAmounts();
        closedMonths = ['2026-09'];
        const closed = await backdate();
        expect([closed.status, closed.body]).toEqual([400, closedMonth('2026-09')]);
        const tooEarly = await backdate({ effectiveFrom: '2026-08-15' });
        expect([tooEarly.status, tooEarly.body]).toEqual([400, beforeStart('2026-09-01')]);

        expect(recordAmounts()).toEqual(before);
        expect(rateTable().map((x) => x[0])).toEqual(['rate1', 'rate2']);
        nothingWritten();
    });

    it('行を足す → 記録を読む → 記録を直す → 履歴 rate_added → 履歴 record_repriced を、1つのトランザクションの中（tx）で、この順に行う', async () => {
        expect((await backdate()).status).toBe(201);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(txCalls).toEqual([
            '$executeRaw', 'allowanceItem.findUnique', 'allowanceRate.findMany', 'allowanceMonthClose.findMany',
            'allowanceRate.create', 'allowanceRecord.findMany', 'allowanceRecord.updateMany', 'allowanceRecord.updateMany',
            'allowanceLog.create', 'allowanceLog.createMany',
        ]);
        expect(callsOutsideTx()).toEqual({});
        expect(transactionOutcomes).toEqual(['done']);
    });
});

// ================================================================ DELETE

describe('DELETE /api/allowances/items/[id]/rates/[rateId]: だれが取り消せるか（管理者だけ）', () => {
    beforeEach(() => {
        rateRows = [firstRate(), rateRow()];
    });

    it('ログインしていなければ 401 のまま返す。何も読まず、何も書かない', async () => {
        logout();
        const r = await deleteRate('rate-x');
        expect([r.status, r.body]).toEqual([401, { error: '認証が必要です' }]);
        noReads();
        noWrites();
    });

    it.each([MANAGER, ...OTHERS])('$role は 403「権限がありません」（マネージャーも取り消せない）。何も読まず、何も書かない', async (user) => {
        loginAs(user);
        const r = await deleteRate('rate-x');
        expect([r.status, r.body]).toEqual([403, { error: '権限がありません' }]);
        noReads();
        noWrites();
    });

    it('DB のロールが大文字（ADMIN）でも、管理者として扱う', async () => {
        loginAs({ ...ADMIN, role: 'ADMIN' });
        expect((await deleteRate('rate-x')).body).toEqual({ ok: true });
    });
});

describe('DELETE /api/allowances/items/[id]/rates/[rateId]: 取り消せない行', () => {
    it('行が無ければ 404「金額が見つかりません」。鍵を取って、行を読むだけ（何も書かない）', async () => {
        const r = await deleteRate('missing');
        expect([r.status, r.body]).toEqual([404, { error: '金額が見つかりません' }]);
        // URL の rateId で読んでいる
        expect(mock(prisma.allowanceRate.findUnique).mock.calls[0][0].where).toEqual({ id: 'missing' });
        expect(txCalls).toEqual(['$executeRaw', 'allowanceRate.findUnique']);
        nothingWritten();
    });

    it('ほかの手当の行（URL の手当と、行の手当が違う）は 404「金額が見つかりません」。何も書かない', async () => {
        rateRows = [firstRate(), rateRow({ id: 'far-rate', itemId: 'far' })];
        const r = await deleteRate('far-rate', 'large');
        expect([r.status, r.body]).toEqual([404, { error: '金額が見つかりません' }]);
        nothingWritten();
        expect(rateTable().map((x) => x[0])).toEqual(['rate1', 'far-rate']);

        // その行の手当の URL からなら、取り消せる（断ったのは、URL の手当が違うから）
        const own = await deleteRate('far-rate', 'far');
        expect([own.status, own.body]).toEqual([200, { ok: true }]);
        expect(rateTable().map((x) => x[0])).toEqual(['rate1']);
    });

    it('もう始まっている行（適用開始日が今日以前。今日ちょうども）は 400「すでに始まっている金額は取り消せません（直すときは、同じ適用開始日で、正しい金額を入れ直してください）」。何も書かない', async () => {
        for (const day of ['2026-10-03', '2026-10-02', '2026-09-01']) {
            rateRows = [rateRow({ effectiveFrom: utc0(day) })];
            const r = await deleteRate('rate-x');
            expect([day, r.status, r.body]).toEqual([day, 400, ALREADY_STARTED]);
            expect(rateTable().map((x) => x[0])).toEqual(['rate-x']);
        }
        nothingWritten();
    });

    it('「今日」は日本時間で決まる（UTC ではまだ前の日でも、日本時間で始まっている行は取り消せない）', async () => {
        rateRows = [rateRow({ effectiveFrom: utc0('2026-10-03') })];

        freezeNow('2026-10-02T15:30:00.000Z'); // 日本時間 10/3 0:30（UTC ではまだ 10/2）
        const started = await deleteRate('rate-x');
        expect([started.status, started.body]).toEqual([400, ALREADY_STARTED]);
        nothingWritten();

        // 日本時間で日付が変わる直前（10/2 23:59）なら、10/3 から始まる行は、まだ予約
        freezeNow('2026-10-02T14:59:59.999Z');
        const upcoming = await deleteRate('rate-x');
        expect([upcoming.status, upcoming.body]).toEqual([200, { ok: true }]);
        expect(rateRows).toEqual([]);
    });

    it('「今日」は、鍵を取ったあとで決める: 鍵を待っているあいだに日付が変わって始まった行は、消さない（400）', async () => {
        rateRows = [rateRow({ effectiveFrom: utc0('2026-10-04') })]; // 呼んだとき（10/3）は、まだ始まっていない予約
        freezeNow('2026-10-03T14:59:59.900Z'); // 日本時間 10/3 23:59:59.900
        whileWaitingForLock(() => jest.setSystemTime(new Date('2026-10-03T15:00:00.100Z'))); // 待っているあいだに、日本時間で 10/4 になる

        const r = await deleteRate('rate-x');
        expect([r.status, r.body]).toEqual([400, ALREADY_STARTED]);
        expect(rateTable().map((x) => x[0])).toEqual(['rate-x']);
        nothingWritten();
    });

    it('行を読むのは、鍵を取ったあと: 2人が同時に取り消したときの後のほうは、もう行が無いので 404（履歴も書かない）', async () => {
        rateRows = [firstRate(), rateRow()];
        // 鍵を待っているあいだに、もう1人の取り消しが終わって、行が消えた
        whileWaitingForLock(() => {
            rateRows = rateRows.filter((x) => x.id !== 'rate-x');
        });
        const r = await deleteRate('rate-x');
        expect([r.status, r.body]).toEqual([404, { error: '金額が見つかりません' }]);
        nothingWritten();
    });
});

describe('DELETE /api/allowances/items/[id]/rates/[rateId]: 予約を取り消す・履歴', () => {
    it('予約なら、その行を消して、取り消した行の全部の列を履歴（rate_cancelled）に残す。{ ok: true }・no-store', async () => {
        rateRows = [firstRate(), rateRow()];
        const r = await deleteRate('rate-x');
        expect([r.status, r.body, r.cache]).toEqual([200, { ok: true }, 'no-store']);

        // 消したのは、その1行だけ
        expect(writesOf(prisma.allowanceRate)).toEqual({ delete: 1 });
        expect(prisma.allowanceRate.delete).toHaveBeenCalledWith({ where: { id: 'rate-x' } });
        expect(rateTable().map((x) => x[0])).toEqual(['rate1']);

        // 日付・日時は、文字にして残す
        expect(logs).toEqual([{
            action: 'rate_cancelled', actorId: 'admin1', actorName: '管理者1', itemId: 'large',
            detail: {
                id: 'rate-x', itemId: 'large', foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-10-10',
                createdBy: 'admin1', createdByName: '管理者1', createdAt: '2026-10-02T01:00:00.000Z',
            },
        }]);
    });

    it('鍵 → 行を読む → 消す → 履歴 を、1つのトランザクションの中（tx）で、この順に行う', async () => {
        rateRows = [firstRate(), rateRow()];
        expect((await deleteRate('rate-x')).status).toBe(200);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(txCalls).toEqual(['$executeRaw', 'allowanceRate.findUnique', 'allowanceRate.delete', 'allowanceLog.create']);
        expect(transactionOutcomes).toEqual(['done']);
        expect(callsOutsideTx()).toEqual({});
        expect(lockSqls()).toEqual([LOCK_SQL]);
        expect(transactionOptions()).toEqual([{ maxWait: 5000, timeout: 10000 }]);
    });

    it('明日から始まる行は、まだ予約なので取り消せる。記録には触らない', async () => {
        rateRows = [firstRate(), rateRow({ effectiveFrom: utc0('2026-10-04') })];
        recordRows = [recordRow('a', 'foremanA', '2026-10-03', 'foreman', 1500, 'rate1')];
        const r = await deleteRate('rate-x');
        expect([r.status, r.body]).toEqual([200, { ok: true }]);
        expect(logs[0].detail).toMatchObject({ id: 'rate-x', effectiveFrom: '2026-10-04' });
        expect(recordAmounts()).toEqual({ a: [1500, 'rate1'] });
        expect(writesOf(prisma.allowanceRecord)).toEqual({});
    });

    it('取り消した人は、ログインしている人。行を入れた人（別の人・入れた人の ID が無い行）は、履歴の中身にそのまま残す', async () => {
        loginAs({ id: 'admin2', role: 'admin' });
        rateRows = [rateRow({ createdBy: null, createdByName: '（最初の設定）' })];
        expect((await deleteRate('rate-x')).status).toBe(200);
        expect(logs[0]).toMatchObject({ actorId: 'admin2', actorName: 'login-admin2' });
        expect(logs[0].detail).toMatchObject({ createdBy: null, createdByName: '（最初の設定）' });
    });

    it('同じ予約を続けて2回取り消すと、2回目は 404（履歴は、取り消した1回ぶんだけ）', async () => {
        rateRows = [firstRate(), rateRow()];
        expect((await deleteRate('rate-x')).status).toBe(200);
        const again = await deleteRate('rate-x');
        expect([again.status, again.body]).toEqual([404, { error: '金額が見つかりません' }]);
        expect(logs.map((l) => l.action)).toEqual(['rate_cancelled']);
        expect(writesOf(prisma.allowanceRate)).toEqual({ delete: 1 });
    });

    it('入れ直した予約の、あとから入れたほうを取り消すと、前の行が、また使われる行に戻る（置きかえられた印が消える）', async () => {
        rateRows = [
            firstRate(),
            rateRow({ id: 'rate-typo', foremanAmount: 18000 }),
            rateRow({ id: 'rate-fixed', createdAt: new Date('2026-10-02T02:00:00.000Z') }),
        ];
        expect(marksOf(await getRates())).toEqual([['rate-fixed', 'upcoming', false], ['rate-typo', 'upcoming', true], ['rate1', 'current', false]]);
        expect((await deleteRate('rate-fixed')).status).toBe(200);
        expect(marksOf(await getRates())).toEqual([['rate-typo', 'upcoming', false], ['rate1', 'current', false]]);
    });
});

// ================================================================ 全体

describe('全体: 設定・金額を直す API が無いこと・DB が失敗したとき・評価ポイントに触らないこと', () => {
    /** その route のファイルが受け付ける HTTP の操作 */
    const methodsOf = (routeModule: Record<string, unknown>) =>
        ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].filter((m) => m in routeModule);

    it("どちらの route も、毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'。前の答えを使い回さない）", () => {
        expect([ratesRoute.dynamic, rateByIdRoute.dynamic]).toEqual(['force-dynamic', 'force-dynamic']);
    });

    it('金額の行を直す API は無い（/rates は GET・POST だけ、/rates/[rateId] は DELETE だけ）', () => {
        expect(methodsOf(ratesRoute)).toEqual(['GET', 'POST']);
        expect(methodsOf(rateByIdRoute)).toEqual(['DELETE']);
    });

    it('DB が失敗したら、どの操作も 500 で返す（足す・消すのに失敗したら、履歴は書かない）', async () => {
        const failure = new Error('DB に届かない');
        rateRows = [firstRate(), rateRow()];
        mock(prisma.allowanceRate.findMany).mockRejectedValue(failure);
        const list = await getRates();
        // モックの serverErrorResponse は、渡された操作の名前をそのまま error に入れる（本物は「◯◯に失敗しました」と返す）
        expect([list.status, (list.body as Body).error]).toEqual([500, '手当の金額の履歴の取得']);

        mock(prisma.allowanceRate.findMany).mockImplementation(async ({ where, orderBy }: FindArgs) => sorted(rateRows.filter((x) => matches(x, where)), orderBy));
        mock(prisma.allowanceRate.create).mockRejectedValue(failure);
        mock(prisma.allowanceRate.delete).mockRejectedValue(failure);
        const added = await postRate(VALID);
        const removed = await deleteRate('rate-x');
        expect([added.status, added.body.error]).toEqual([500, '手当の金額の変更']);
        expect([removed.status, removed.body.error]).toEqual([500, '手当の金額の予約の取り消し']);
        expect(logs).toEqual([]);
        expect(transactionOutcomes).toEqual(['failed', 'failed']);
    });

    it('記録を直すのに失敗したら 500（トランザクションごと失敗させる＝金額の行を足したことにしない）。履歴は書かない', async () => {
        rateRows = [firstRate()];
        recordRows = [recordRow('a', 'foremanA', '2026-09-20', 'foreman', 1500, 'rate1')];
        mock(prisma.allowanceRecord.updateMany).mockRejectedValue(new Error('DB に届かない'));
        const r = await postRate({ foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-09-15' });
        expect([r.status, r.body.error, r.body.rate]).toEqual([500, '手当の金額の変更', undefined]);
        expect(logs).toEqual([]);
        // トランザクションに渡した関数が、例外で終わっている（本物の DB なら、足した行も元に戻る）
        expect(transactionOutcomes).toEqual(['failed']);
    });

    it('履歴を書くのに失敗したら 500（トランザクションごと失敗させる＝足した・消したことにしない）', async () => {
        rateRows = [firstRate(), rateRow()];
        mock(prisma.allowanceLog.create).mockRejectedValue(new Error('DB に届かない'));
        const added = await postRate(VALID);
        const removed = await deleteRate('rate-x');
        expect([added.status, added.body.rate, removed.status, removed.body.ok]).toEqual([500, undefined, 500, undefined]);
        // トランザクションに渡した関数が、例外で終わっている（本物の DB なら、足した行・消した行も元に戻る）
        expect(transactionOutcomes).toEqual(['failed', 'failed']);
    });

    it('鍵が取れなかったら 500（足す・取り消す）。何も読まず、何も書かない', async () => {
        rateRows = [firstRate(), rateRow()];
        mock(prisma.$executeRaw).mockRejectedValue(new Error('鍵を待っているうちに時間切れ'));
        const added = await postRate(VALID);
        const removed = await deleteRate('rate-x');
        expect([added.status, removed.status]).toEqual([500, 500]);
        noReads();
        nothingWritten();
        expect(rateTable().map((x) => x[0])).toEqual(['rate1', 'rate-x']);
        expect(transactionOutcomes).toEqual(['failed', 'failed']);
    });

    it('評価ポイントの表（別のデータ）には、いっさい触らない（読むとき・足すとき・記録を合わせるとき・取り消すとき・断るとき）', async () => {
        rateRows = [firstRate(), rateRow()];
        recordRows = [recordRow('a', 'foremanA', '2026-09-20', 'foreman', 1500, 'rate1')];
        expect((await getRates()).status).toBe(200);
        expect((await postRate(VALID)).status).toBe(201);
        expect((await postRate({ ...VALID, effectiveFrom: '2026-09-15' })).body.repriced).toBe(1);
        expect((await postRate({ ...VALID, effectiveFrom: '2026-08-01' })).status).toBe(400);
        expect((await deleteRate('rate-x')).status).toBe(200);
        expect((await deleteRate('rate1')).status).toBe(400);
        // 金額は手当の金額の表（allowanceRate）に、記録は手当の記録（allowanceRecord）に、履歴は手当の履歴（allowanceLog）に書いている
        expect(writesOf(prisma.allowanceRate)).toEqual({ create: 2, delete: 1 });
        expect(writesOf(prisma.allowanceRecord)).toEqual({ updateMany: 1 });
        expect(logs.map((l) => l.action)).toEqual(['rate_added', 'rate_added', 'record_repriced', 'rate_cancelled']);
        evaluationPointsUntouched();
    });
});
