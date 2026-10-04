/**
 * @jest-environment node
 *
 * 手当の種類の API のテスト（docs/指示書_大規模手当.md の 6-1）。
 *   GET   /api/allowances/items        全部の手当（始まりの日・今の金額・予約・記録の件数つき）。admin・manager
 *   PATCH /api/allowances/items/[id]   名前・説明・使う／使わない を直す。admin だけ
 *   app/api/allowances/items/_shared.ts（入力の読み方と、一覧の1行の形）
 *
 * 評価ポイントの点数表（__tests__/api/evaluation-points/items/route.test.ts）と同じ形の API だが、次の点が違う:
 *   - 手当の行は、マイグレーションで作る。画面からは増やさない・消さない・並べ替えない（POST・DELETE・並べ替えの API は無い）
 *   - 直せるのは 名前・説明・使う／使わない だけ（対象の工事内容・並び順・金額は、ここでは直せない）
 *   - 金額は2つ（職長・職長以外）。どの適用開始日よりも前の日付には、金額が無い
 *     ＝いちばん古い適用開始日が、その手当の始まりの日（評価ポイントは「最初の点数を前の日付にも使う」が、手当は違う）
 *   - 直すとき（PATCH）は、全体が1つのトランザクション: 書き込みの鍵 → 今の行を読む → 同じ名前が無いか → 変わった列だけ直す → 履歴
 *     （読むのもトランザクションの中。記録を足す・月を締める などと同じ鍵なので、手当の書き込みは1つずつ順番に行われる）
 *
 * route は、lib/allowances.ts・lib/allowancesServer.ts・lib/allowancesReport.ts の関数を、本物のまま呼ぶ。
 * @/lib/prisma と @/lib/api/utils だけは、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * このファイルでは、手当（items）と金額の履歴（rates）だけ「渡された条件を見て答える」ようにしてある（beforeEach を参照）。
 * 「絞り込みが正しいか」は、返ってきた値だけでなく、findMany・findUnique・findFirst・update に渡した引数でも確かめる。
 *
 * $transaction は、jest.setup.ts と同じ動き（同じモックの prisma を渡して、すぐ実行する）のまま、
 * 「トランザクションの中（tx）から呼ばれた操作の名前」（txCalls。鍵＝$executeRaw も入る）と「終わり方」（transactionOutcomes）を残すようにしてある。
 * tx を通さずに（外の prisma で）読み書きした操作は callsOutsideTx() で分かる。
 *
 * 日付: 金額の適用開始日は、過去の決まった日（2026年8月〜9月）か、遠い先（2099年）を使う。
 * 「今日」を見る決まり（今の金額・予約）を確かめるテストだけ、時計（Date だけ）を固定する（freezeNow。日本時間）。
 */
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import * as itemsRoute from '@/app/api/allowances/items/route';
import * as itemByIdRoute from '@/app/api/allowances/items/[id]/route';
import { asObject, parseName, parseOptionalText, toAllowanceItemResponse } from '@/app/api/allowances/items/_shared';
import type { AllowanceRateLike } from '@/lib/allowances';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const { GET } = itemsRoute;
const { PATCH } = itemByIdRoute;

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
/** 管理者でもマネージャーでもない人たち（職長向けの手当の一覧は GET /day が返すので、この API は使えない） */
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

// ---------------------------------------------------------------- 呼び方と、応答の読み方

const jsonRequest = (urlPath: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${urlPath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        // 文字列は、そのまま body にする（JSON として読めない body を送るため）
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

interface UpcomingBody { id: string; foremanAmount: number; memberAmount: number; effectiveFrom: string }
/** 一覧の1行（GET の配列の中身・PATCH の { item }） */
interface ItemBody {
    id: string; name: string; description: string | null; constructionContent: string; isActive: boolean; sortOrder: number;
    startDate: string | null; current: { foremanAmount: number; memberAmount: number } | null; upcomingRates: UpcomingBody[]; recordCount: number;
}
interface PatchBody { error?: string; details?: string; item?: ItemBody }

const getItems = async () => {
    const res = await GET();
    return { status: res.status, body: (await res.json()) as unknown, cache: res.headers.get('Cache-Control') };
};
/** GET の応答を、手当の配列として読む（配列でなければ、その場でテストを落とす） */
const itemsOf = (r: { body: unknown }): ItemBody[] => {
    if (!Array.isArray(r.body)) throw new Error(`応答が配列ではありません: ${JSON.stringify(r.body)}`);
    return r.body as ItemBody[];
};
const patch = async (id: string, body?: unknown) => {
    const res = await PATCH(jsonRequest(`/api/allowances/items/${id}`, 'PATCH', body), { params: { id } });
    return { status: res.status, body: (await res.json()) as PatchBody, cache: res.headers.get('Cache-Control') };
};

/** 形のまちがい（validationErrorResponse）は、モックでは { error: 'Validation Error', details: 文言 } になる */
const INVALID_INPUT = { error: 'Validation Error', details: '入力が不正です' };
/** 形のまちがいの文言（どの列が違うかで分かれる。そのほかは「入力が不正です」） */
const GENERAL_MESSAGE = '入力が不正です';
const NAME_MESSAGE = '名前は1〜30字で入れてください';
const DESCRIPTION_MESSAGE = '説明は200字までの文字で入れてください';
/** 手当の書き込みの鍵（記録を足す・月を締める・金額を変える などと同じ鍵） */
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('dandolink-allowance'))";

// ---------------------------------------------------------------- DB の中身（モックが返すもの）

/** 手当の行（route が読む列＝ITEM_SELECT の形） */
interface ItemRow {
    id: string; name: string; description: string | null; constructionContent: string; isActive: boolean; sortOrder: number;
    _count: { records: number };
}
/** route が手当を読む・直すときに指定する列 */
const ITEM_SELECT = {
    id: true, name: true, description: true, constructionContent: true, isActive: true, sortOrder: true,
    _count: { select: { records: true } },
};
const LARGE_DESCRIPTION = '工事内容が「大規模」の現場に入った日に付けます。';
/** 既定は、マイグレーションで作る「大規模手当」を「使う」にしたもの（記録は 0件） */
const itemRow = (over: Partial<ItemRow> = {}): ItemRow => ({
    id: 'large', name: '大規模手当', description: LARGE_DESCRIPTION, constructionContent: '大規模',
    isActive: true, sortOrder: 0, _count: { records: 0 }, ...over,
});
/** 2つ目の手当（今は使っていない） */
const farRow = (over: Partial<ItemRow> = {}): ItemRow =>
    itemRow({ id: 'far', name: '遠方手当', description: null, constructionContent: '遠方', isActive: false, sortOrder: 1, ...over });

/** 金額の履歴の行（loadAllowanceRatesByItemId が読む列） */
interface RateRow { id: string; itemId: string; foremanAmount: number; memberAmount: number; effectiveFrom: Date; createdAt: Date }
const rateRow = (id: string, effectiveFrom: string, foremanAmount: number, memberAmount: number, over: Partial<RateRow> = {}): RateRow => ({
    id, itemId: 'large', foremanAmount, memberAmount, effectiveFrom: utc0(effectiveFrom), createdAt: new Date('2026-08-25T01:00:00.000Z'), ...over,
});

/** 手当の表・金額の履歴の表の中身。テストごとに決める（beforeEach で、大規模手当の1行・金額なし に戻す） */
let items: ItemRow[] = [];
let rates: RateRow[] = [];

// ---------------------------------------------------------------- トランザクション

type Db = typeof prisma;
/** トランザクションの中（tx）から呼ばれた操作の名前（呼ばれた順） */
let txCalls: string[] = [];
/** $transaction に渡した関数の終わり方（'done' = 最後まで進んだ／'failed' = 例外で終わった＝本物の DB なら、中の書き込みは取り消される） */
let transactionOutcomes: ('done' | 'failed')[] = [];

/**
 * トランザクションの中で渡す prisma（tx）。中身は同じモックだが、tx を通して呼ばれた操作の名前を txCalls に残す
 * （表の操作は 'allowanceItem.update' の形、鍵は '$executeRaw'）。
 * route が tx ではなく外の prisma で読み書きしたら（＝トランザクションの外で読み書きしたら）、txCalls に残らないので分かる
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
/** 手当の表に、何も書いていないこと（手当の行も、金額も、履歴も。鍵を取って読むところまでは、進んでいてもよい） */
const nothingWritten = () => {
    for (const [name, model] of Object.entries(ALLOWANCE_MODELS)) {
        expect([name, writesOf(model)]).toEqual([name, {}]);
    }
};
/** 保存の手前で断っていること（トランザクションを開いていない・鍵も取っていない・何も書いていない） */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    nothingWritten();
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
/** DB を何も読んでいないこと */
const noReads = () => {
    expect(prisma.allowanceItem.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.allowanceItem.findFirst).not.toHaveBeenCalled();
    expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
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

/** allowanceItem.update に渡した引数（1回目の呼び出し） */
const updateArgs = () => mock(prisma.allowanceItem.update).mock.calls[0][0] as { where: unknown; data: Record<string, unknown>; select: unknown };
/** 書いた履歴の行（1回目の呼び出し） */
const logData = () => (mock(prisma.allowanceLog.create).mock.calls[0][0] as { data: Record<string, unknown> }).data;

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(ADMIN);
    items = [itemRow()];
    rates = [];
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

    // 手当: 一覧は where を見ずに全部返す。1件は ID で、同じ名前の確かめは「名前が同じで、除く ID でない行」で探す
    mock(prisma.allowanceItem.findMany).mockImplementation(async () => items);
    mock(prisma.allowanceItem.findUnique).mockImplementation(async ({ where }: { where: { id: string } }) =>
        items.find((i) => i.id === where.id) ?? null);
    mock(prisma.allowanceItem.findFirst).mockImplementation(async ({ where }: { where: { name: string; id?: { not: string } } }) => {
        const found = items.find((i) => i.name === where.name && i.id !== where.id?.not);
        return found ? { id: found.id } : null;
    });
    // 直すと、表の中身も変わる（返すのは、直したあとの行）
    mock(prisma.allowanceItem.update).mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<ItemRow> }) => {
        const index = items.findIndex((i) => i.id === where.id);
        if (index < 0) throw new Error(`直す手当がありません: ${where.id}`);
        items[index] = { ...items[index], ...data };
        return items[index];
    });
    // 金額の履歴は、問い合わせた手当の分だけを返す
    mock(prisma.allowanceRate.findMany).mockImplementation(async ({ where }: { where: { itemId: { in: string[] } } }) =>
        rates.filter((r) => where.itemId.in.includes(r.itemId)));
    mock(prisma.allowanceLog.create).mockResolvedValue({});
});

afterEach(() => {
    jest.useRealTimers();
});

// ================================================================ GET /items

describe('GET /api/allowances/items: だれが見られるか', () => {
    it('ログインしていなければ 401 のまま返す。何も読まない', async () => {
        logout();
        const r = await getItems();
        expect([r.status, r.body]).toEqual([401, { error: '認証が必要です' }]);
        noReads();
        noWrites();
    });

    it.each(OTHERS)('$role は 403「権限がありません」。何も読まない', async (user) => {
        loginAs(user);
        const r = await getItems();
        expect([r.status, r.body]).toEqual([403, { error: '権限がありません' }]);
        noReads();
        noWrites();
    });

    it('ロールの入っていないセッションも 403（id が管理者のものでも、ロールで決める）', async () => {
        mock(requireAuth).mockResolvedValue({ session: { user: { id: 'admin1', name: '管理者1' } }, error: null });
        const r = await getItems();
        expect([r.status, r.body]).toEqual([403, { error: '権限がありません' }]);
        noReads();
    });

    it('管理者・マネージャーは見られる（DB のロールが大文字まじりでも、小文字にそろえて比べる）', async () => {
        for (const user of [ADMIN, MANAGER, { ...ADMIN, role: 'ADMIN' }, { ...MANAGER, role: 'Manager' }]) {
            loginAs(user);
            const r = await getItems();
            expect([user.role, r.status, itemsOf(r).map((i) => i.id)]).toEqual([user.role, 200, ['large']]);
        }
    });
});

describe('GET /api/allowances/items: 読み方（モックは where を見ないので、渡した引数で確かめる）', () => {
    it('全部の手当を sortOrder → createdAt の順で読む（where なし＝使っていない手当も）。記録の件数（_count.records）も読む', async () => {
        expect((await getItems()).status).toBe(200);
        expect(prisma.allowanceItem.findMany).toHaveBeenCalledTimes(1);
        const args = mock(prisma.allowanceItem.findMany).mock.calls[0][0] as { where?: unknown; orderBy: unknown; select: unknown };
        // 絞り込み（where）も、件数の上限（take）も無い
        expect(Object.keys(args).sort()).toEqual(['orderBy', 'select']);
        expect(args.where).toBeUndefined();
        expect(args.orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
        expect(args.select).toEqual({
            id: true, name: true, description: true, constructionContent: true, isActive: true, sortOrder: true,
            _count: { select: { records: true } },
        });
    });

    it('金額の履歴は、読んだ手当の ID でまとめて1回だけ引く', async () => {
        items = [itemRow(), farRow(), itemRow({ id: 'new', name: '新しい手当', sortOrder: 2 })];
        expect((await getItems()).status).toBe(200);
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledTimes(1);
        expect(mock(prisma.allowanceRate.findMany).mock.calls[0][0].where).toEqual({ itemId: { in: ['large', 'far', 'new'] } });
    });

    it('手当が1つも無ければ、空の配列を返す', async () => {
        items = [];
        const r = await getItems();
        expect([r.status, r.body]).toEqual([200, []]);
    });
});

describe('GET /api/allowances/items: 応答', () => {
    it('応答は、手当の配列そのもの（DB が返した順）。1行に、始まりの日・今の金額・予約（日付の古い順）・記録の件数が付く。no-store', async () => {
        freezeNow('2026-10-03T03:00:00.000Z'); // 日本時間 10/3 12:00
        items = [
            itemRow({ _count: { records: 12 } }),
            farRow({ _count: { records: 3 } }),                                                              // 使っていない手当も出す
            itemRow({ id: 'new', name: '金額がまだ無い手当', description: null, constructionContent: '夜間', isActive: false, sortOrder: 2 }),
            itemRow({ id: 'soon', name: 'これから始まる手当', description: '11月から', constructionContent: '高所', sortOrder: 3 }),
        ];
        // DB が返す並びは、ばらばら（金額の履歴は、並びを指定せずに読む）
        rates = [
            rateRow('r4', '2026-12-01', 2000, 300),                       // 予約（先のほう）
            rateRow('r2', '2026-10-01', 1600, 250),                       // 今の金額（今日以前で、いちばん新しい適用開始日）
            rateRow('f1', '2026-08-01', 1000, 100, { itemId: 'far' }),
            rateRow('s2', '2027-01-01', 600, 60, { itemId: 'soon' }),
            rateRow('r3', '2026-10-04', 1800, 280),                       // 予約（明日から）
            rateRow('r1', '2026-09-01', 1500, 200),                       // 最初の金額（マイグレーションで作る行）
            rateRow('s1', '2026-11-01', 500, 50, { itemId: 'soon' }),
        ];

        const r = await getItems();
        expect([r.status, r.cache]).toEqual([200, 'no-store']);
        expect(r.body).toEqual([
            {
                id: 'large', name: '大規模手当', description: LARGE_DESCRIPTION, constructionContent: '大規模', isActive: true, sortOrder: 0,
                startDate: '2026-09-01',
                current: { foremanAmount: 1600, memberAmount: 250 },
                upcomingRates: [
                    { id: 'r3', foremanAmount: 1800, memberAmount: 280, effectiveFrom: '2026-10-04' },
                    { id: 'r4', foremanAmount: 2000, memberAmount: 300, effectiveFrom: '2026-12-01' },
                ],
                recordCount: 12,
            },
            {
                id: 'far', name: '遠方手当', description: null, constructionContent: '遠方', isActive: false, sortOrder: 1,
                startDate: '2026-08-01', current: { foremanAmount: 1000, memberAmount: 100 }, upcomingRates: [], recordCount: 3,
            },
            {
                // 金額の行が1つも無い手当: 始まりの日も、今の金額も無い
                id: 'new', name: '金額がまだ無い手当', description: null, constructionContent: '夜間', isActive: false, sortOrder: 2,
                startDate: null, current: null, upcomingRates: [], recordCount: 0,
            },
            {
                // 今日が始まりの日より前: 今の金額は無い（最初の金額を、前の日付には使わない）
                id: 'soon', name: 'これから始まる手当', description: '11月から', constructionContent: '高所', isActive: true, sortOrder: 3,
                startDate: '2026-11-01', current: null,
                upcomingRates: [
                    { id: 's1', foremanAmount: 500, memberAmount: 50, effectiveFrom: '2026-11-01' },
                    { id: 's2', foremanAmount: 600, memberAmount: 60, effectiveFrom: '2027-01-01' },
                ],
                recordCount: 0,
            },
        ]);
        noWrites();
    });

    it('時計を固定しなくても同じ: 過去の適用開始日の行が今の金額、遠い先（2099年）の行が予約', async () => {
        rates = [rateRow('future', '2099-01-01', 3000, 500), rateRow('r1', '2026-09-01', 1500, 200)];
        expect(itemsOf(await getItems())).toEqual([{
            id: 'large', name: '大規模手当', description: LARGE_DESCRIPTION, constructionContent: '大規模', isActive: true, sortOrder: 0,
            startDate: '2026-09-01', current: { foremanAmount: 1500, memberAmount: 200 },
            upcomingRates: [{ id: 'future', foremanAmount: 3000, memberAmount: 500, effectiveFrom: '2099-01-01' }],
            recordCount: 0,
        }]);
    });

    it('今日ちょうどから始まる行は「今の金額」で、予約には入らない（明日から始まる行は予約）', async () => {
        freezeNow('2026-10-03T03:00:00.000Z'); // 日本時間 10/3 12:00
        rates = [rateRow('r1', '2026-09-01', 1500, 200), rateRow('today', '2026-10-03', 1700, 250), rateRow('tomorrow', '2026-10-04', 1900, 300)];
        const [item] = itemsOf(await getItems());
        expect(item.current).toEqual({ foremanAmount: 1700, memberAmount: 250 });
        expect(item.upcomingRates).toEqual([{ id: 'tomorrow', foremanAmount: 1900, memberAmount: 300, effectiveFrom: '2026-10-04' }]);
    });

    it('「今日」は日本時間で決まる（UTC ではまだ前の日でも、日本時間で日付が変わっていれば、その日から始まる行が今の金額）', async () => {
        rates = [rateRow('r1', '2026-09-01', 1500, 200), rateRow('r2', '2026-10-03', 1700, 250)];

        freezeNow('2026-10-02T14:59:59.999Z'); // 日本時間 10/2 23:59（まだ 10/2）
        const before = itemsOf(await getItems())[0];
        expect([before.current, before.upcomingRates.map((u) => u.id)]).toEqual([{ foremanAmount: 1500, memberAmount: 200 }, ['r2']]);

        freezeNow('2026-10-02T15:00:00.000Z'); // 日本時間 10/3 0:00（UTC ではまだ 10/2）
        const after = itemsOf(await getItems())[0];
        expect([after.current, after.upcomingRates]).toEqual([{ foremanAmount: 1700, memberAmount: 250 }, []]);
    });

    it('同じ適用開始日が2行あれば、後から入れた行が今の金額（DB が返す並び・ID の大小によらない）', async () => {
        freezeNow('2026-10-03T03:00:00.000Z');
        // ID の大小は、入れた順と逆にしてある（ID で決めていたら、答えが変わる）
        const first = rateRow('z-first', '2026-10-01', 1600, 220, { createdAt: new Date('2026-09-30T01:00:00.000Z') });
        const second = rateRow('a-second', '2026-10-01', 1700, 250, { createdAt: new Date('2026-09-30T02:00:00.000Z') });
        for (const sameDay of [[first, second], [second, first]]) {
            rates = [rateRow('r1', '2026-09-01', 1500, 200), ...sameDay];
            const [item] = itemsOf(await getItems());
            expect([item.startDate, item.current, item.upcomingRates]).toEqual(['2026-09-01', { foremanAmount: 1700, memberAmount: 250 }, []]);
        }
    });

    it('0円の金額も「今の金額」として出す（null にしない）', async () => {
        rates = [rateRow('zero', '2026-09-01', 0, 0)];
        expect(itemsOf(await getItems())[0].current).toEqual({ foremanAmount: 0, memberAmount: 0 });
    });

    it('金額は、その手当の分だけを使う（ほかの手当の金額・予約が混ざらない）', async () => {
        items = [itemRow(), farRow()];
        rates = [
            rateRow('f1', '2026-08-01', 1000, 100, { itemId: 'far' }),
            rateRow('r1', '2026-09-01', 1500, 200),
            rateRow('f2', '2099-01-01', 1200, 120, { itemId: 'far' }),
        ];
        const [large, far] = itemsOf(await getItems());
        expect([large.startDate, large.current, large.upcomingRates]).toEqual(['2026-09-01', { foremanAmount: 1500, memberAmount: 200 }, []]);
        expect([far.startDate, far.current, far.upcomingRates.map((u) => u.id)]).toEqual(['2026-08-01', { foremanAmount: 1000, memberAmount: 100 }, ['f2']]);
    });
});

// ================================================================ PATCH /items/[id]

describe('PATCH /api/allowances/items/[id]: だれが直せるか（管理者だけ）', () => {
    it('ログインしていなければ 401 のまま返す。何も読まず、何も書かない', async () => {
        logout();
        const r = await patch('large', { isActive: false });
        expect([r.status, r.body]).toEqual([401, { error: '認証が必要です' }]);
        noReads();
        noWrites();
    });

    it.each([MANAGER, ...OTHERS])('$role は 403「権限がありません」（マネージャーも直せない）。何も読まず、何も書かない', async (user) => {
        loginAs(user);
        const r = await patch('large', { isActive: false });
        expect([r.status, r.body]).toEqual([403, { error: '権限がありません' }]);
        noReads();
        noWrites();
    });

    it('ロールの入っていないセッションも 403', async () => {
        mock(requireAuth).mockResolvedValue({ session: { user: { id: 'admin1', name: '管理者1' } }, error: null });
        expect((await patch('large', { isActive: false })).status).toBe(403);
        noWrites();
    });

    it('DB のロールが大文字（ADMIN）でも、管理者として扱う', async () => {
        loginAs({ ...ADMIN, role: 'ADMIN' });
        const r = await patch('large', { isActive: false });
        expect([r.status, r.body.item?.isActive]).toEqual([200, false]);
    });
});

describe('PATCH /api/allowances/items/[id]: 入力の形（合わなければ 400。トランザクションを開かず、鍵も取らず、何も書かない）', () => {
    /** [どんな入力か, 返る文言, body] */
    const BAD_BODIES: [string, string, unknown][] = [
        ['body が無い', GENERAL_MESSAGE, undefined],
        ['JSON として読めない', GENERAL_MESSAGE, 'JSON ではない'],
        ['配列', GENERAL_MESSAGE, []],
        ['配列（中身は正しい形）', GENERAL_MESSAGE, [{ isActive: false }]],
        ['null', GENERAL_MESSAGE, null],
        ['文字列', GENERAL_MESSAGE, '"大規模手当"'],
        ['数', GENERAL_MESSAGE, 5],
        ['何も指定が無い', GENERAL_MESSAGE, {}],
        // 名前の形が違うときは、名前の文言
        ['name が空', NAME_MESSAGE, { name: '' }],
        ['name が空白だけ', NAME_MESSAGE, { name: '   ' }],
        ['name が全角の空白だけ', NAME_MESSAGE, { name: '　' }],
        ['name が31字', NAME_MESSAGE, { name: 'あ'.repeat(31) }],
        ['name が数', NAME_MESSAGE, { name: 1 }],
        ['name が null', NAME_MESSAGE, { name: null }],
        ['name が配列', NAME_MESSAGE, { name: ['大規模手当'] }],
        // 説明の形が違うときは、説明の文言
        ['description が201字', DESCRIPTION_MESSAGE, { description: 'あ'.repeat(201) }],
        ['description が数', DESCRIPTION_MESSAGE, { description: 5 }],
        ['description が boolean', DESCRIPTION_MESSAGE, { description: false }],
        ['isActive が文字', GENERAL_MESSAGE, { isActive: 'false' }],
        ['isActive が数', GENERAL_MESSAGE, { isActive: 0 }],
        ['isActive が null', GENERAL_MESSAGE, { isActive: null }],
        ['正しい列と一緒でも、形の違う列が1つあれば、全部を断る（name）', NAME_MESSAGE, { name: '', isActive: false }],
        ['正しい列と一緒でも、形の違う列が1つあれば、全部を断る（description）', DESCRIPTION_MESSAGE, { name: '新しい名前', description: 5 }],
        ['正しい列と一緒でも、形の違う列が1つあれば、全部を断る（isActive）', GENERAL_MESSAGE, { name: '新しい名前', isActive: 'yes' }],
        // 形の違う列が2つ以上あるとき: 名前 → 説明 → 使う／使わない の順に見て、最初に当たった文言を返す
        ['name も description も形が違う（名前の文言が先）', NAME_MESSAGE, { description: 5, name: '' }],
        ['description も isActive も形が違う（説明の文言が先）', DESCRIPTION_MESSAGE, { isActive: 'yes', description: 5 }],
    ];

    it.each(BAD_BODIES)('%s → 400「%s」', async (_label, message, body) => {
        const r = await patch('large', body);
        expect([r.status, r.body]).toEqual([400, { error: 'Validation Error', details: message }]);
        noReads();
        noWrites();
    });

    it('対象の工事内容（constructionContent）・並び順（sortOrder）だけを送っても、何も指定が無いのと同じ → 400（ここでは直せない）', async () => {
        const bodies = [
            { constructionContent: '中規模' }, { sortOrder: 5 }, { constructionContent: '中規模', sortOrder: 5 },
            // 金額・ID・記録の件数 なども、ここでは直せない
            { foremanAmount: 3000, memberAmount: 500 }, { id: 'other' }, { recordCount: 0 }, { startDate: '2026-08-01' },
        ];
        for (const body of bodies) {
            const r = await patch('large', body);
            expect([JSON.stringify(body), r.status, r.body]).toEqual([JSON.stringify(body), 400, INVALID_INPUT]);
        }
        noWrites();
    });

    it('constructionContent・sortOrder を、ほかの列と一緒に送ったら、その列だけを直す（対象の工事内容・並び順は変わらない）', async () => {
        const r = await patch('large', { isActive: false, constructionContent: '中規模', sortOrder: 5, id: 'other', foremanAmount: 3000 });
        expect(r.status).toBe(200);
        expect(prisma.allowanceItem.update).toHaveBeenCalledTimes(1);
        expect(updateArgs().where).toEqual({ id: 'large' });
        expect(updateArgs().data).toEqual({ isActive: false });
        expect(logData().detail).toEqual({ before: { isActive: true }, after: { isActive: false } });
        expect(r.body.item).toMatchObject({ id: 'large', constructionContent: '大規模', sortOrder: 0, isActive: false });
        // 金額の行も足していない
        expect(prisma.allowanceRate.create).not.toHaveBeenCalled();
    });

    it('境目: 名前は30字まで・説明は200字まで通る（前後の空白は、字数に数えない）', async () => {
        const name30 = 'あ'.repeat(30);
        const description200 = 'い'.repeat(200);
        const r = await patch('large', { name: `  ${name30}  `, description: `  ${description200}  ` });
        expect(r.status).toBe(200);
        expect(updateArgs().data).toEqual({ name: name30, description: description200 });
    });
});

describe('PATCH /api/allowances/items/[id]: 手当が無い・同じ名前', () => {
    it('手当が無ければ 404「手当が見つかりません」。鍵を取って読むだけで、何も書かない', async () => {
        const r = await patch('missing', { isActive: false });
        expect([r.status, r.body]).toEqual([404, { error: '手当が見つかりません' }]);
        // URL の ID で読んでいる
        expect(prisma.allowanceItem.findUnique).toHaveBeenCalledWith({ where: { id: 'missing' }, select: ITEM_SELECT });
        expect(txCalls).toEqual(['$executeRaw', 'allowanceItem.findUnique']);
        nothingWritten();
    });

    it('同じ名前の手当がほかにあれば 400「同じ名前の手当が、すでにあります」（使っていない手当とも・前後の空白を取って比べる）。何も書かない', async () => {
        items = [itemRow(), farRow()]; // 遠方手当は「使わない」になっている
        const r = await patch('large', { name: '  遠方手当  ', isActive: false });
        expect([r.status, r.body]).toEqual([400, { error: '同じ名前の手当が、すでにあります' }]);
        // 名前だけで探している（isActive では絞らない）。自分自身は除く
        expect(prisma.allowanceItem.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceItem.findFirst).toHaveBeenCalledWith({ where: { name: '遠方手当', id: { not: 'large' } }, select: { id: true } });
        expect(txCalls).toEqual(['$executeRaw', 'allowanceItem.findUnique', 'allowanceItem.findFirst']);
        nothingWritten();
    });

    it('ほかの手当と重ならない名前なら、変えられる', async () => {
        items = [itemRow(), farRow()];
        const r = await patch('large', { name: '大規模現場の手当' });
        expect([r.status, r.body.item?.name]).toEqual([200, '大規模現場の手当']);
        expect(updateArgs().data).toEqual({ name: '大規模現場の手当' });
    });

    it('自分自身の名前のまま（前後に空白が付いていても）なら、同じ名前では断らない', async () => {
        items = [itemRow(), farRow()];
        const r = await patch('large', { name: ' 大規模手当 ', isActive: false });
        expect(r.status).toBe(200);
        // 名前は変わっていないので、直すのは「使わない」だけ
        expect(updateArgs().data).toEqual({ isActive: false });
    });

    it('名前を変えないなら、同じ名前の手当がすでに2つあっても、ほかの列は直せる（名前を変えるときだけ、重なりを確かめる）', async () => {
        // マイグレーションなどで、同じ名前の行が2つできてしまっている
        items = [itemRow(), itemRow({ id: 'twin', sortOrder: 1 })];
        const r = await patch('large', { name: '大規模手当', isActive: false });
        expect([r.status, r.body.item?.isActive]).toEqual([200, false]);
        expect(updateArgs().data).toEqual({ isActive: false });
    });
});

describe('PATCH /api/allowances/items/[id]: 直す・履歴', () => {
    it('変わった列だけを update し、履歴（item_updated）の before・after も変わった列だけ。同じトランザクションの中で、直す → 履歴 の順に書く', async () => {
        items = [itemRow({ description: null })];
        // name は今と同じ（変わらない）。description と isActive だけが変わる
        const r = await patch('large', { name: '大規模手当', description: ' 現場が大きい日の手当 ', isActive: false });
        expect(r.status).toBe(200);

        expect(prisma.allowanceItem.update).toHaveBeenCalledTimes(1);
        expect(updateArgs()).toEqual({ where: { id: 'large' }, data: { description: '現場が大きい日の手当', isActive: false }, select: ITEM_SELECT });
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        expect(logData()).toEqual({
            action: 'item_updated', actorId: 'admin1', actorName: '管理者1', itemId: 'large',
            detail: { before: { description: null, isActive: true }, after: { description: '現場が大きい日の手当', isActive: false } },
        });

        // 鍵 → 今の行を読む → 直す → 履歴 を、1つのトランザクションの中（tx）で（名前は変わらないので、同じ名前の確かめは無い）
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(txCalls).toEqual(['$executeRaw', 'allowanceItem.findUnique', 'allowanceItem.update', 'allowanceLog.create']);
        expect(transactionOutcomes).toEqual(['done']);
    });

    it('全体が1つのトランザクション: 書き込みの鍵 → 今の行を読む → 同じ名前が無いか → 直す → 履歴 の順。読むのも tx を通す', async () => {
        items = [itemRow(), farRow()];
        const r = await patch('large', { name: '大規模現場の手当', isActive: false });
        expect(r.status).toBe(200);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(txCalls).toEqual(['$executeRaw', 'allowanceItem.findUnique', 'allowanceItem.findFirst', 'allowanceItem.update', 'allowanceLog.create']);
        expect(transactionOutcomes).toEqual(['done']);
        // 鍵は1回だけ。記録を足す・月を締める・金額を変える などと同じ鍵
        expect(lockSqls()).toEqual([LOCK_SQL]);
        // トランザクションの設定: DB の接続の空きを待つのは5秒まで・トランザクションの全体は10秒まで（鍵を待つ時間も全体に入るので、既定の5秒より長い）
        expect(transactionOptions()).toEqual([{ maxWait: 5000, timeout: 10000 }]);
        // 手当の行・履歴・鍵は、tx の外（prisma を直接）では読み書きしていない
        // （応答に付ける金額の履歴だけは、トランザクションが終わったあとで読んでもよい）
        const outside = callsOutsideTx();
        delete outside['allowanceRate.findMany'];
        expect(outside).toEqual({});
    });

    it('読むのは、鍵を取ったあと: 鍵を待っているあいだに、ほかの手当が同じ名前になっていたら 400（待つ前の中身で通さない）', async () => {
        items = [itemRow(), farRow()];
        // 鍵を待っているあいだに、ほかの管理者が、遠方手当の名前を「現場手当」に直した
        mock(prisma.$executeRaw).mockImplementationOnce(async () => {
            items[1] = { ...items[1], name: '現場手当' };
            return 0;
        });
        const r = await patch('large', { name: '現場手当' });
        expect([r.status, r.body]).toEqual([400, { error: '同じ名前の手当が、すでにあります' }]);
        nothingWritten();
    });

    it('読むのは、鍵を取ったあと: 鍵を待っているあいだに、ほかの人が同じ直しを済ませていたら、update も履歴も書かない', async () => {
        // 鍵を待っているあいだに、ほかの管理者が「使わない」にした
        mock(prisma.$executeRaw).mockImplementationOnce(async () => {
            items[0] = { ...items[0], isActive: false };
            return 0;
        });
        const r = await patch('large', { isActive: false });
        expect([r.status, r.body.item?.isActive]).toEqual([200, false]);
        nothingWritten();
    });

    it('URL の手当だけを直す（ほかの手当の行は変わらない）', async () => {
        items = [itemRow(), farRow()];
        const r = await patch('far', { isActive: true, description: '片道2時間をこえる現場' });
        expect(r.status).toBe(200);
        expect(prisma.allowanceItem.findUnique).toHaveBeenCalledWith({ where: { id: 'far' }, select: ITEM_SELECT });
        expect(prisma.allowanceItem.update).toHaveBeenCalledTimes(1);
        expect(updateArgs().where).toEqual({ id: 'far' });
        expect(logData()).toMatchObject({
            itemId: 'far',
            detail: { before: { description: null, isActive: false }, after: { description: '片道2時間をこえる現場', isActive: true } },
        });
        expect(r.body.item).toMatchObject({ id: 'far', name: '遠方手当', description: '片道2時間をこえる現場', constructionContent: '遠方', isActive: true, sortOrder: 1 });
        // 大規模手当の行は、そのまま
        expect(items[0]).toEqual(itemRow());
    });

    it('名前・説明・使う／使わない を、まとめて直せる（3つとも変われば、3つとも update と履歴に入る）', async () => {
        const r = await patch('large', { name: '大規模現場の手当', description: null, isActive: false });
        expect(r.status).toBe(200);
        expect(updateArgs().data).toEqual({ name: '大規模現場の手当', description: null, isActive: false });
        expect(logData().detail).toEqual({
            before: { name: '大規模手当', description: LARGE_DESCRIPTION, isActive: true },
            after: { name: '大規模現場の手当', description: null, isActive: false },
        });
    });

    it('書くのは、手当の行（update の1回）と履歴（create の1回）だけ。名前を直しても、記録に写してある名前・金額の行は直さない', async () => {
        items = [itemRow({ _count: { records: 7 } })];
        rates = [rateRow('r1', '2026-09-01', 1500, 200)];
        expect((await patch('large', { name: '大規模現場の手当', isActive: false })).status).toBe(200);
        expect(writesOf(prisma.allowanceItem)).toEqual({ update: 1 });
        expect(writesOf(prisma.allowanceLog)).toEqual({ create: 1 });
        // すでに付いた記録（付けた時点の名前の写し）・金額の履歴・締め・公開の設定には、何も書かない
        expect(writesOf(prisma.allowanceRecord)).toEqual({});
        expect(writesOf(prisma.allowanceRate)).toEqual({});
        expect(writesOf(prisma.allowanceMonthClose)).toEqual({});
        expect(writesOf(prisma.allowanceSetting)).toEqual({});
    });

    it('「使わない」のままの手当も、名前・説明を直せる（使い始める前に、名前と説明を整えられる）', async () => {
        items = [itemRow({ isActive: false })];
        const r = await patch('large', { name: '大規模現場の手当', description: '大規模の現場に入った日' });
        expect(r.status).toBe(200);
        expect(updateArgs().data).toEqual({ name: '大規模現場の手当', description: '大規模の現場に入った日' });
        expect(r.body.item).toMatchObject({ name: '大規模現場の手当', description: '大規模の現場に入った日', isActive: false });
    });

    it('「使わない」の手当を「使う」にできる（マイグレーションで作った行は、使わない状態で始まる）', async () => {
        items = [itemRow({ isActive: false })];
        const r = await patch('large', { isActive: true });
        expect([r.status, r.body.item?.isActive]).toEqual([200, true]);
        expect(updateArgs().data).toEqual({ isActive: true });
        expect(logData()).toMatchObject({ action: 'item_updated', itemId: 'large', detail: { before: { isActive: false }, after: { isActive: true } } });
    });

    it('name は前後の空白（全角の空白も）を取って保存する。description の空・空白だけ・null は null にする', async () => {
        const r = await patch('large', { name: ' 　大規模現場の手当　 ', description: '   ' });
        expect(r.status).toBe(200);
        expect(updateArgs().data).toEqual({ name: '大規模現場の手当', description: null });
        expect(logData().detail).toEqual({
            before: { name: '大規模手当', description: LARGE_DESCRIPTION },
            after: { name: '大規模現場の手当', description: null },
        });
        expect(r.body.item).toMatchObject({ name: '大規模現場の手当', description: null });

        for (const description of ['', null]) {
            items = [itemRow()];
            mock(prisma.allowanceItem.update).mockClear();
            expect((await patch('large', { description })).status).toBe(200);
            expect([description, updateArgs().data]).toEqual([description, { description: null }]);
        }
    });

    it('何も変わらなければ、update も履歴も無い（200 で、今の中身を返す）。鍵は取る', async () => {
        items = [itemRow({ _count: { records: 7 } })];
        const bodies = [
            { name: '大規模手当' }, { name: '  大規模手当  ' }, { isActive: true }, { description: LARGE_DESCRIPTION },
            { name: '大規模手当', description: ` ${LARGE_DESCRIPTION} `, isActive: true },
        ];
        for (const body of bodies) {
            const r = await patch('large', body);
            expect([JSON.stringify(body), r.status, r.body]).toEqual([JSON.stringify(body), 200, {
                item: {
                    id: 'large', name: '大規模手当', description: LARGE_DESCRIPTION, constructionContent: '大規模', isActive: true, sortOrder: 0,
                    startDate: null, current: null, upcomingRates: [], recordCount: 7,
                },
            }]);
        }
        nothingWritten();
        // 鍵は毎回取って、今の行を読むところまでは進む（同じ名前の確かめも、名前が変わらないので無い）
        expect(lockSqls()).toEqual(bodies.map(() => LOCK_SQL));
        expect(txCalls).toEqual(bodies.flatMap(() => ['$executeRaw', 'allowanceItem.findUnique']));
        expect(transactionOutcomes).toEqual(bodies.map(() => 'done'));
    });

    it('説明が無い手当に、空・空白だけ・null の説明を送っても、変わらない（update も履歴も無い）', async () => {
        items = [itemRow({ description: null })];
        for (const description of ['', '   ', null]) {
            const r = await patch('large', { description });
            expect([description, r.status, r.body.item?.description]).toEqual([description, 200, null]);
        }
        nothingWritten();
    });

    it('履歴の「操作した人」は、ログインしている人の ID と名前。名前の無い session では、ログイン名を写す', async () => {
        loginAs({ id: 'admin2', role: 'admin' });
        expect((await patch('large', { isActive: false })).status).toBe(200);
        expect(logData()).toMatchObject({ actorId: 'admin2', actorName: 'login-admin2' });
    });
});

describe('PATCH /api/allowances/items/[id]: 応答', () => {
    it('応答 { item } は、直したあとの行で、GET の1行と同じ形（始まりの日・今の金額・予約・記録の件数つき）。no-store', async () => {
        freezeNow('2026-10-03T03:00:00.000Z'); // 日本時間 10/3 12:00
        items = [itemRow({ _count: { records: 7 } }), farRow()];
        rates = [
            rateRow('r2', '2026-11-01', 1800, 250),
            rateRow('f1', '2026-08-01', 1000, 100, { itemId: 'far' }),
            rateRow('r1', '2026-09-01', 1500, 200),
        ];
        const r = await patch('large', { name: '大規模現場の手当', isActive: false });
        expect([r.status, r.cache]).toEqual([200, 'no-store']);
        expect(r.body).toEqual({
            item: {
                id: 'large', name: '大規模現場の手当', description: LARGE_DESCRIPTION, constructionContent: '大規模', isActive: false, sortOrder: 0,
                startDate: '2026-09-01', current: { foremanAmount: 1500, memberAmount: 200 },
                upcomingRates: [{ id: 'r2', foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-11-01' }],
                recordCount: 7,
            },
        });
        // 金額の履歴は、その手当の分だけを読む
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledTimes(1);
        expect(mock(prisma.allowanceRate.findMany).mock.calls[0][0].where).toEqual({ itemId: { in: ['large'] } });
        // このあと一覧を読むと、同じ1行が返る
        expect(itemsOf(await getItems())[0]).toEqual(r.body.item);
    });

    it('応答の記録の件数は、直したあとに DB が返した行のもの（読んだときの行を使い回さない）', async () => {
        items = [itemRow({ _count: { records: 7 } })];
        // update が返した行の件数（8）が、読んだときの行の件数（7）と違う場合
        mock(prisma.allowanceItem.update).mockImplementation(async ({ data }: { data: Partial<ItemRow> }) => ({ ...itemRow({ _count: { records: 8 } }), ...data }));
        const r = await patch('large', { isActive: false });
        expect([r.body.item?.isActive, r.body.item?.recordCount]).toEqual([false, 8]);
    });

    it('応答の「今の金額」の「今日」も、日本時間で決まる（UTC ではまだ前の日でも）', async () => {
        freezeNow('2026-10-02T15:30:00.000Z'); // 日本時間 10/3 0:30
        rates = [rateRow('r1', '2026-09-01', 1500, 200), rateRow('r2', '2026-10-03', 1700, 250)];
        const r = await patch('large', { isActive: false });
        expect([r.body.item?.current, r.body.item?.upcomingRates]).toEqual([{ foremanAmount: 1700, memberAmount: 250 }, []]);
    });
});

// ================================================================ _shared.ts（入力の読み方・一覧の1行の形）

describe('_shared.ts: 入力の読み方', () => {
    it('asObject: JSON のオブジェクト（配列でない）だけを、そのまま返す。配列・null・文字・数・boolean は null', () => {
        const value = { name: '大規模手当', nested: { a: 1 } };
        expect(asObject(value)).toBe(value);
        expect(asObject({})).toEqual({});
        const bad: unknown[] = [null, undefined, [], [1, 2], [{ name: 'x' }], 'x', '', 0, 5, true, false];
        for (const b of bad) {
            expect([JSON.stringify(b), asObject(b)]).toEqual([JSON.stringify(b), null]);
        }
    });

    it('parseName: 文字列で、前後の空白を取って 1〜max 字のものだけ（取ったあとの名前を返す）。違えば null', () => {
        expect(parseName('大規模手当', 30)).toBe('大規模手当');
        expect(parseName('  大規模手当\n', 30)).toBe('大規模手当');
        expect(parseName('　大規模手当　', 30)).toBe('大規模手当'); // 全角の空白も取る
        expect(parseName('大規模 手当', 30)).toBe('大規模 手当');   // 中の空白は、そのまま
        // 字数は、空白を取ったあとで数える（ちょうど max 字は通る・1字多いと null）
        expect(parseName('あ', 1)).toBe('あ');
        expect(parseName(' あい ', 2)).toBe('あい');
        expect(parseName('あいう', 2)).toBeNull();
        expect(parseName('あ'.repeat(30), 30)).toBe('あ'.repeat(30));
        expect(parseName('あ'.repeat(31), 30)).toBeNull();
        const bad: unknown[] = ['', '   ', '　', '\n', 1, 0, null, undefined, true, {}, ['大規模手当']];
        for (const b of bad) {
            expect([JSON.stringify(b), parseName(b, 30)]).toEqual([JSON.stringify(b), null]);
        }
    });

    it('parseOptionalText: 前後の空白を取って max 字まで。空・空白だけ・null は null にする。文字列でも null でもない・字数の外は { ok: false }', () => {
        expect(parseOptionalText('説明', 200)).toEqual({ ok: true, value: '説明' });
        expect(parseOptionalText('  説明　', 200)).toEqual({ ok: true, value: '説明' });
        expect(parseOptionalText(null, 200)).toEqual({ ok: true, value: null });
        expect(parseOptionalText('', 200)).toEqual({ ok: true, value: null });
        expect(parseOptionalText('   ', 200)).toEqual({ ok: true, value: null });
        // 字数は、空白を取ったあとで数える
        expect(parseOptionalText(' あい ', 2)).toEqual({ ok: true, value: 'あい' });
        expect(parseOptionalText('あいう', 2)).toEqual({ ok: false });
        expect(parseOptionalText('あ'.repeat(200), 200)).toEqual({ ok: true, value: 'あ'.repeat(200) });
        expect(parseOptionalText('あ'.repeat(201), 200)).toEqual({ ok: false });
        const bad: unknown[] = [5, 0, true, false, undefined, {}, ['説明']];
        for (const b of bad) {
            expect([JSON.stringify(b), parseOptionalText(b, 200)]).toEqual([JSON.stringify(b), { ok: false }]);
        }
    });
});

describe('_shared.ts: toAllowanceItemResponse（一覧の1行の形）', () => {
    /** 金額の履歴の1行（loadAllowanceRatesByItemId が返す形: 日付は文字） */
    const like = (id: string, effectiveFrom: string, foremanAmount: number, memberAmount: number, createdAt = '2026-08-25T01:00:00.000Z'): AllowanceRateLike =>
        ({ id, foremanAmount, memberAmount, effectiveFrom, createdAt });
    const ROW = { id: 'large', name: '大規模手当', description: null, constructionContent: '大規模', isActive: true, sortOrder: 4 };
    const TODAY = '2026-10-03';

    it('手当の行の6つの列はそのまま。記録の件数・始まりの日・今の金額・予約を足す（行に余分な列があっても、出さない）', () => {
        const row = { ...ROW, _count: { records: 99 }, createdAt: new Date('2026-09-01T00:00:00.000Z') };
        const res = toAllowanceItemResponse(row, [like('r1', '2026-09-01', 1500, 200)], 12, TODAY);
        expect(res).toEqual({
            id: 'large', name: '大規模手当', description: null, constructionContent: '大規模', isActive: true, sortOrder: 4,
            startDate: '2026-09-01', current: { foremanAmount: 1500, memberAmount: 200 }, upcomingRates: [], recordCount: 12,
        });
        expect(Object.keys(res).sort()).toEqual([
            'constructionContent', 'current', 'description', 'id', 'isActive', 'name', 'recordCount', 'sortOrder', 'startDate', 'upcomingRates',
        ]);
    });

    it('始まりの日は、いちばん古い適用開始日（並びによらない・予約だけでも）。金額の行が無ければ null', () => {
        const startOf = (rs: AllowanceRateLike[]) => toAllowanceItemResponse(ROW, rs, 0, TODAY).startDate;
        const three = [like('b', '2026-10-01', 1, 1), like('a', '2026-09-01', 1, 1), like('c', '2026-12-01', 1, 1)];
        expect(startOf(three)).toBe('2026-09-01');
        expect(startOf([...three].reverse())).toBe('2026-09-01');
        expect(startOf([like('c', '2026-12-01', 1, 1), like('d', '2026-11-01', 1, 1)])).toBe('2026-11-01');
        expect(startOf([])).toBeNull();
    });

    it('今の金額は「今日以前で、いちばん新しい適用開始日」の行（今日ちょうども含む）。今日が始まりの日より前なら null', () => {
        const currentOf = (rs: AllowanceRateLike[], today = TODAY) => toAllowanceItemResponse(ROW, rs, 0, today).current;
        const history = [like('r2', '2026-10-03', 1700, 250), like('r3', '2026-10-04', 1900, 300), like('r1', '2026-09-01', 1500, 200)];
        expect(currentOf(history, '2026-08-31')).toBeNull();                                             // 始まりの日の前の日
        expect(currentOf(history, '2026-09-01')).toEqual({ foremanAmount: 1500, memberAmount: 200 });   // 始まりの日
        expect(currentOf(history, '2026-10-02')).toEqual({ foremanAmount: 1500, memberAmount: 200 });
        expect(currentOf(history, '2026-10-03')).toEqual({ foremanAmount: 1700, memberAmount: 250 });   // 今日から始まる行
        expect(currentOf(history, '2026-10-04')).toEqual({ foremanAmount: 1900, memberAmount: 300 });
        expect(currentOf(history, '2099-12-31')).toEqual({ foremanAmount: 1900, memberAmount: 300 });
        expect(currentOf([])).toBeNull();
    });

    it('同じ適用開始日が2行あれば、後から入れた行（入れた日時も同じなら、ID の大きいほう）', () => {
        const currentOf = (rs: AllowanceRateLike[]) => toAllowanceItemResponse(ROW, rs, 0, TODAY).current;
        const early = like('z', '2026-10-01', 1600, 220, '2026-09-30T01:00:00.000Z');
        const late = like('a', '2026-10-01', 1700, 250, '2026-09-30T02:00:00.000Z');
        expect(currentOf([early, late])).toEqual({ foremanAmount: 1700, memberAmount: 250 });
        expect(currentOf([late, early])).toEqual({ foremanAmount: 1700, memberAmount: 250 });
        const sameTimeSmallId = like('a', '2026-10-01', 1600, 220, '2026-09-30T01:00:00.000Z');
        const sameTimeBigId = like('b', '2026-10-01', 1700, 250, '2026-09-30T01:00:00.000Z');
        expect(currentOf([sameTimeSmallId, sameTimeBigId])).toEqual({ foremanAmount: 1700, memberAmount: 250 });
        expect(currentOf([sameTimeBigId, sameTimeSmallId])).toEqual({ foremanAmount: 1700, memberAmount: 250 });
    });

    it('予約は、適用開始日が今日より後の行だけ（今日ちょうどは入らない）。適用開始日の古い順 → 入れた日時の古い順 → ID の小さい順。出すのは4つの項目だけ', () => {
        // 11/1 から始まる行が3つ。ID の順（same-0 → same-a1 → same-a2）は、入れた順（same-a1・same-a2 → same-0）と、わざと逆にしてある
        const input = [
            like('late', '2026-12-01', 2000, 300),
            like('same-0', '2026-11-01', 1900, 290, '2026-10-01T02:00:00.000Z'),
            like('today', '2026-10-03', 1700, 250),
            like('same-a2', '2026-11-01', 1800, 280, '2026-10-01T01:00:00.000Z'),
            like('same-a1', '2026-11-01', 1850, 285, '2026-10-01T01:00:00.000Z'),
            like('tomorrow', '2026-10-04', 1750, 260),
            like('past', '2026-09-01', 1500, 200),
        ];
        const order = input.map((r) => r.id);
        const res = toAllowanceItemResponse(ROW, input, 0, TODAY);
        expect(res.upcomingRates).toEqual([
            { id: 'tomorrow', foremanAmount: 1750, memberAmount: 260, effectiveFrom: '2026-10-04' },
            { id: 'same-a1', foremanAmount: 1850, memberAmount: 285, effectiveFrom: '2026-11-01' },
            { id: 'same-a2', foremanAmount: 1800, memberAmount: 280, effectiveFrom: '2026-11-01' },
            { id: 'same-0', foremanAmount: 1900, memberAmount: 290, effectiveFrom: '2026-11-01' },
            { id: 'late', foremanAmount: 2000, memberAmount: 300, effectiveFrom: '2026-12-01' },
        ]);
        // 逆の並びから始めても、同じ結果
        expect(toAllowanceItemResponse(ROW, [...input].reverse(), 0, TODAY).upcomingRates).toEqual(res.upcomingRates);
        // 渡した配列の並びは変えない
        expect(input.map((r) => r.id)).toEqual(order);
    });
});

// ================================================================ 全体

describe('全体: 設定・手当を増やす API が無いこと・DB が失敗したとき・評価ポイントに触らないこと', () => {
    /** その route のファイルが受け付ける HTTP の操作 */
    const methodsOf = (routeModule: Record<string, unknown>) =>
        ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].filter((m) => m in routeModule);
    /** そのフォルダの下にある route のファイル（フォルダからの相対パス） */
    const routeFilesUnder = (dir: string, base = dir): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return routeFilesUnder(full, base);
            return /^route\.(ts|tsx|js|jsx)$/.test(entry.name) ? [path.relative(base, full).split(path.sep).join('/')] : [];
        });

    it("どちらの route も、毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'。前の答えを使い回さない）", () => {
        expect([itemsRoute.dynamic, itemByIdRoute.dynamic]).toEqual(['force-dynamic', 'force-dynamic']);
    });

    it('手当の種類を増やす・消す・並べ替える API は無い（/items は GET だけ・/items/[id] は PATCH だけ・並べ替えの route は無い）', () => {
        expect(methodsOf(itemsRoute)).toEqual(['GET']);
        expect(methodsOf(itemByIdRoute)).toEqual(['PATCH']);
        // /api/allowances/items の下にある route は、一覧・1件・金額の履歴・金額の予約の取り消し の4つだけ
        const itemsDir = path.resolve(__dirname, '../../../../app/api/allowances/items');
        expect(routeFilesUnder(itemsDir).sort()).toEqual(['[id]/rates/[rateId]/route.ts', '[id]/rates/route.ts', '[id]/route.ts', 'route.ts']);
    });

    it('DB が失敗したら 500 で返す（一覧・直す）。直すのに失敗したら、履歴は書かない', async () => {
        const failure = new Error('DB に届かない');
        mock(prisma.allowanceItem.findMany).mockRejectedValue(failure);
        const list = await getItems();
        // モックの serverErrorResponse は、渡された操作の名前をそのまま error に入れる（本物は「◯◯に失敗しました」と返す）
        expect([list.status, (list.body as { error?: string }).error]).toEqual([500, '手当の種類の取得']);

        mock(prisma.allowanceItem.update).mockRejectedValue(failure);
        const updated = await patch('large', { isActive: false });
        expect([updated.status, updated.body.error]).toEqual([500, '手当の種類の更新']);
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
        expect(transactionOutcomes).toEqual(['failed']);
    });

    it('鍵が取れなかったら 500（手当の行を読まず、何も書かない）', async () => {
        mock(prisma.$executeRaw).mockRejectedValue(new Error('鍵を待っているうちに時間切れ'));
        const r = await patch('large', { isActive: false });
        expect([r.status, r.body.error]).toEqual([500, '手当の種類の更新']);
        expect(prisma.allowanceItem.findUnique).not.toHaveBeenCalled();
        nothingWritten();
        expect(transactionOutcomes).toEqual(['failed']);
    });

    it('金額の履歴が読めなかったときも 500（一覧を、金額なしで返したりしない）', async () => {
        mock(prisma.allowanceRate.findMany).mockRejectedValue(new Error('DB に届かない'));
        expect((await getItems()).status).toBe(500);
    });

    it('履歴を書くのに失敗したら 500（トランザクションごと失敗させる＝直したことにしない）', async () => {
        mock(prisma.allowanceLog.create).mockRejectedValue(new Error('DB に届かない'));
        const r = await patch('large', { isActive: false });
        expect([r.status, r.body.error, r.body.item]).toEqual([500, '手当の種類の更新', undefined]);
        // トランザクションに渡した関数が、例外で終わっている（本物の DB なら、直した分も取り消される）
        expect(transactionOutcomes).toEqual(['failed']);
    });

    it('評価ポイントの表（別のデータ）には、いっさい触らない（一覧を読むとき・直すとき・断るとき）', async () => {
        items = [itemRow(), farRow()];
        rates = [rateRow('r1', '2026-09-01', 1500, 200)];
        expect((await getItems()).status).toBe(200);
        expect((await patch('large', { name: '大規模現場の手当', description: null, isActive: false })).status).toBe(200);
        expect((await patch('large', { name: '遠方手当' })).status).toBe(400);
        expect((await patch('missing', { isActive: true })).status).toBe(404);
        // 履歴は、手当の履歴（allowanceLog）に書いている
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        evaluationPointsUntouched();
    });
});
