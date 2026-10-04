/**
 * @jest-environment node
 *
 * GET /api/allowances/summary?month=YYYY-MM（手当の、月の、人ごとの集計）のテスト。
 *
 *   見られる人: 管理者（admin）・マネージャー（manager）だけ。月は必須。
 *   返すもの:   lib/allowancesReport.ts の loadAllowanceSummary(month) の答え
 *               （CSV の集計＝GET /export?type=summary も同じ関数を使う＝同じ人・同じ並び・同じ数字）に、
 *               unclosedPastMonths（終わったのに締めていない月。古い順）を足したもの。
 *               unclosedPastMonths は lib/allowancesServer.ts の loadUnclosedPastMonths() の答え
 *               ＝ 画面が「◯月分がまだ締められていません」を出すのに使う。
 *
 * route は lib/allowances.ts・lib/allowancesReport.ts・lib/allowancesServer.ts の関数を本物のまま呼ぶ。
 * 差し替えているのは、jest.setup.ts の @/lib/prisma と @/lib/api/utils だけ
 * （prisma のモックは where を見ずに、テストが決めた答えを返すだけ）。
 * だから「その月の記録だけか」は、返ってきた値ではなく、allowanceRecord.findMany に渡した where で確かめる。
 * user.findMany は「在籍している人 ＋ 記録のある人」を、joyoContractor.findMany は「支払明細書の対象者」を、このテストが決めて返す。
 *
 * いちばん守りたい約束:
 *   - 全員の手当の金額が出るので、見られるのは管理者・マネージャーだけ（公開の設定がオンでも、職長・作業員には出さない）
 *   - 合計は、記録に入っている金額の足し算。確認待ちは合計に入れない
 *   - 社員の分（給与に付ける）と、常用の一人親方の分（支払明細書に載せる）に分ける。足すと全体の合計になる
 *   - 締め忘れの月（今月より前で、記録があって、締めていない月）を、もれなく・古い順に知らせる
 *
 * 日付: 過去の決まった月（2026年9月 など）を使う。
 * 集計そのものは時計を見ないが、unclosedPastMonths は「今月（日本時間）より前か」を見る。
 * その決まりを確かめるテストだけ、時計を固定する（freezeNow）。ほかのテストでは、
 * allowanceRecord.groupBy（記録のある日付）が where を見ずに決めた答えを返すので、本物の時計が何月でも、同じ結果になる。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, dynamic } from '@/app/api/allowances/summary/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { loadAllowanceSummary, type AllowanceSummaryResponse, type AllowanceTotals } from '@/lib/allowancesReport';
import { loadUnclosedPastMonths } from '@/lib/allowancesServer';

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);
/** ID の並びは問わずに比べる（where の in は、並びが違っても同じ絞り込み） */
const sorted = (ids: readonly string[]) => [...ids].sort();

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

// ---------------------------------------------------------------- ログインしている人

interface LoginUser { id: string; role?: string | null; name?: string }
/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: LoginUser) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN: LoginUser = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER: LoginUser = { id: 'manager1', role: 'manager', name: 'マネージャー1' };

/** 管理者でもマネージャーでもない人（ロールの入っていないセッションも） */
const NOT_MANAGERS: LoginUser[] = [
    { id: 'foremanA', role: 'foreman2', name: '職長A' },
    { id: 'foremanB', role: 'foreman1', name: '職長B' },
    { id: 'worker1', role: 'worker', name: '作業員1' },
    { id: 'partner1', role: 'partner', name: '協力会社' },
    { id: 'pm1', role: 'partner_member', name: '協力会社のメンバー' },
    { id: 'accountant1', role: 'accountant', name: '税理士' },
    { id: 'support1', role: 'support', name: '応援' },
    { id: 'nobody1', role: '', name: 'ロールが空' },
    { id: 'nobody2', role: null, name: 'ロールが null' },
    { id: 'nobody3', name: 'ロールが無い' },
];

// ---------------------------------------------------------------- 呼び方と、応答の読み方

/** 応答 = 月の集計（loadAllowanceSummary の答え）＋ 終わったのに締めていない月 */
type SummaryBody = Partial<AllowanceSummaryResponse> & { unclosedPastMonths?: string[]; error?: string; details?: string };

/** GET /summary を呼ぶ。query は '?' の後ろ（既定は 2026年9月） */
const getSummary = async (query = 'month=2026-09') => {
    const res = await GET(new NextRequest(`http://localhost/api/allowances/summary${query === '' ? '' : `?${query}`}`));
    return { status: res.status, body: (await res.json()) as SummaryBody, cache: res.headers.get('Cache-Control') };
};
/** month の値を、そのまま（空白や記号も）クエリに入れて呼ぶ */
const getMonth = (month: string) => getSummary(new URLSearchParams({ month }).toString());

// ---------------------------------------------------------------- DB の中身（モックが返すもの）

/** 手当の記録の1行（集計で読む列だけ） */
const rec = (userId: string, payRole: string, amount: number, status = 'confirmed', itemId = 'large') => ({ userId, itemId, payRole, amount, status });

/**
 * 2026年9月の記録（DB が月で絞ったあとの結果を、このテストが決めて返す。並びは、ばらばら）。
 *   職長A        … 職長として 2日（1,500円）・ほかの人の班に入った日 1日（200円）・自分で付けた確認待ち 1件（1,500円）
 *   作業員1      … 職長以外 3日（200円）
 *   作業員2      … 職長以外 1日（200円）
 *   常用の親方1  … 職長以外 2日（200円）。支払明細書の対象者（常用の一人親方）
 *   辞めた作業員 … 職長以外 1日（200円）＋ 今は使っていない手当 1日（100円）。もう在籍していない
 */
const RECORDS = [
    rec('worker1', 'member', 200),
    rec('foremanA', 'foreman', 1500),
    rec('joyo1', 'member', 200),
    rec('retired', 'member', 200),
    rec('foremanA', 'foreman', 1500, 'pending'),
    rec('worker2', 'member', 200),
    rec('foremanA', 'foreman', 1500),
    rec('worker1', 'member', 200),
    rec('retired', 'member', 100, 'confirmed', 'old'),
    rec('joyo1', 'member', 200),
    rec('foremanA', 'member', 200),
    rec('worker1', 'member', 200),
];
/** この月に記録のある人（5人） */
const RECORD_USER_IDS = ['worker1', 'foremanA', 'joyo1', 'retired', 'worker2'];

/** 手当（DB が sortOrder → createdAt の順で返したあとの結果） */
const ITEM_ROWS = [
    { id: 'large', name: '大規模手当', isActive: true },
    { id: 'old', name: '旧手当', isActive: false },          // 今は使っていないが、この月に記録がある
    { id: 'spare', name: '予備の手当', isActive: true },      // 使用中だが、この月の記録は無い
    { id: 'unused', name: '使わない手当', isActive: false },  // 使っていなくて、記録も無い
];

/**
 * user.findMany の答え（「在籍している人 ＋ 記録のある人」を、このテストが決めて返す。並びは、ばらばら）。
 * role は DB の値のまま（大文字が混ざる）。dispatchSortOrder は、人の並びに使う順番（null は最後）。
 * 並び順の無い2人（作業員2・管理者1）は、名前の日本語順で並ぶ。どの環境でも同じ順になるように、
 * 作業員2 の名前は ひらがな で始めてある（ひらがな → 漢字 の順）。
 */
const USERS = [
    { id: 'admin1', displayName: '管理者1', role: 'ADMIN', isActive: true, dispatchSortOrder: null },
    { id: 'worker2', displayName: 'あおき（作業員2）', role: 'worker', isActive: true, dispatchSortOrder: null },
    { id: 'joyo1', displayName: '常用の親方1', role: 'WORKER', isActive: true, dispatchSortOrder: 5 },
    { id: 'retired', displayName: '辞めた作業員', role: 'WORKER', isActive: false, dispatchSortOrder: 3 },
    { id: 'pm1', displayName: '協力会社のメンバー', role: 'PARTNER_MEMBER', isActive: true, dispatchSortOrder: 0 },
    { id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: true, dispatchSortOrder: 2 },
    { id: 'manager1', displayName: 'マネージャー1', role: 'Manager', isActive: true, dispatchSortOrder: 4 },
    { id: 'joyo2', displayName: '常用の親方2', role: 'worker', isActive: true, dispatchSortOrder: 6 },
    { id: 'foremanA', displayName: '職長A', role: 'FOREMAN2', isActive: true, dispatchSortOrder: 1 },
];

/** 支払明細書の対象者（常用の一人親方）に登録されている人 */
const JOYO_ROWS = [{ userId: 'joyo1' }, { userId: 'joyo2' }];

/**
 * 記録のある日付（allowanceRecord.groupBy が返す行＝日付ごとに1行）を決める。
 * ほかのモックと同じで、where を見ずに、決めた答えをそのまま返す（＝本物の時計が何月でも、同じ答え）。
 */
const recordDaysAre = (...dateKeys: string[]) =>
    mock(prisma.allowanceRecord.groupBy).mockResolvedValue(dateKeys.map((key) => ({ date: utc0(key) })));

/**
 * DB に入っている「記録のある日付」を決める（先の月・今月の分も入れてよい）。
 * モックは where を見ないので、ここで「頼まれた日付（where の date.lt）より前」の日付だけを返すようにする
 * （本物の DB と同じ答えになる）。時計を固定して、「今月より前だけを数える」ことを確かめるテストで使う。
 */
const recordDaysInDb = (...dateKeys: string[]) =>
    mock(prisma.allowanceRecord.groupBy).mockImplementation(async ({ where }: { where: { date: { lt: Date } } }) =>
        dateKeys.map(utc0).filter((date) => date.getTime() < where.date.lt.getTime()).map((date) => ({ date })));

/** 締めた月（allowanceMonthClose.findMany が返す行） */
const closedMonthsAre = (...months: string[]) =>
    mock(prisma.allowanceMonthClose.findMany).mockResolvedValue(months.map((month) => ({ month })));

const ZERO_TOTALS: AllowanceTotals = {
    foremanDays: 0, foremanAmount: 0, memberDays: 0, memberAmount: 0, totalDays: 0, totalAmount: 0, pendingCount: 0, pendingAmount: 0,
};
const TOTAL_KEYS = Object.keys(ZERO_TOTALS) as (keyof AllowanceTotals)[];

/** 上の中身のときの、2026年9月の集計（手で計算した答え） */
const EXPECTED_SEPTEMBER: AllowanceSummaryResponse = {
    month: '2026-09',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    closed: null,
    // 使用中の手当 ＋ この月に記録のある手当（使っていなくて記録も無い「使わない手当」は出ない）
    items: [
        { id: 'large', name: '大規模手当', isActive: true },
        { id: 'old', name: '旧手当', isActive: false },
        { id: 'spare', name: '予備の手当', isActive: true },
    ],
    // この月に記録のある人だけ。並びは dispatchSortOrder の小さい順（null は最後）
    people: [
        {
            // 職長 2日 × 1,500円 ＋ 職長以外 1日 × 200円 ＝ 3,200円。自分で付けた確認待ち（1,500円）は合計に入らない
            userId: 'foremanA', displayName: '職長A', role: 'foreman2', isJoyo: false,
            byItem: { large: { foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200 } },
            foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200,
            totalDays: 3, totalAmount: 3200, pendingCount: 1, pendingAmount: 1500,
        },
        {
            userId: 'worker1', displayName: '作業員1', role: 'worker', isJoyo: false,
            byItem: { large: { foremanDays: 0, foremanAmount: 0, memberDays: 3, memberAmount: 600 } },
            foremanDays: 0, foremanAmount: 0, memberDays: 3, memberAmount: 600,
            totalDays: 3, totalAmount: 600, pendingCount: 0, pendingAmount: 0,
        },
        {
            // 辞めた人でも、記録があれば出す（手当ごとの内訳に分かれる）
            userId: 'retired', displayName: '辞めた作業員', role: 'worker', isJoyo: false,
            byItem: {
                large: { foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 200 },
                old: { foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 100 },
            },
            foremanDays: 0, foremanAmount: 0, memberDays: 2, memberAmount: 300,
            totalDays: 2, totalAmount: 300, pendingCount: 0, pendingAmount: 0,
        },
        {
            // 常用の一人親方（支払明細書の対象者）
            userId: 'joyo1', displayName: '常用の親方1', role: 'worker', isJoyo: true,
            byItem: { large: { foremanDays: 0, foremanAmount: 0, memberDays: 2, memberAmount: 400 } },
            foremanDays: 0, foremanAmount: 0, memberDays: 2, memberAmount: 400,
            totalDays: 2, totalAmount: 400, pendingCount: 0, pendingAmount: 0,
        },
        {
            // 並び順の無い人（null）は最後
            userId: 'worker2', displayName: 'あおき（作業員2）', role: 'worker', isJoyo: false,
            byItem: { large: { foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 200 } },
            foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 200,
            totalDays: 1, totalAmount: 200, pendingCount: 0, pendingAmount: 0,
        },
    ],
    // 5人の足し算（確認待ちの 1,500円は、合計に入れずに別に出す）
    totals: { foremanDays: 2, foremanAmount: 3000, memberDays: 9, memberAmount: 1700, totalDays: 11, totalAmount: 4700, pendingCount: 1, pendingAmount: 1500 },
    totalsByKind: {
        // 社員（給与に付ける分）: 職長A・作業員1・辞めた作業員・作業員2
        employee: { foremanDays: 2, foremanAmount: 3000, memberDays: 7, memberAmount: 1300, totalDays: 9, totalAmount: 4300, pendingCount: 1, pendingAmount: 1500 },
        // 常用の一人親方（支払明細書に載せる分）: 常用の親方1
        joyo: { foremanDays: 0, foremanAmount: 0, memberDays: 2, memberAmount: 400, totalDays: 2, totalAmount: 400, pendingCount: 0, pendingAmount: 0 },
    },
    // 「記録を足す」で選べる人: 在籍していて、手当をもらえるロールの全員（記録が無くても出す。協力会社のメンバー・辞めた人は出さない）
    eligiblePeople: [
        { userId: 'foremanA', displayName: '職長A', role: 'foreman2', isJoyo: false },
        { userId: 'worker1', displayName: '作業員1', role: 'worker', isJoyo: false },
        { userId: 'manager1', displayName: 'マネージャー1', role: 'manager', isJoyo: false },
        { userId: 'joyo1', displayName: '常用の親方1', role: 'worker', isJoyo: true },
        { userId: 'joyo2', displayName: '常用の親方2', role: 'worker', isJoyo: true },
        { userId: 'worker2', displayName: 'あおき（作業員2）', role: 'worker', isJoyo: false },
        { userId: 'admin1', displayName: '管理者1', role: 'admin', isJoyo: false },
    ],
};

/**
 * 上の中身のときの、応答の全部（集計 ＋ 終わったのに締めていない月）。
 * 記録のある日付は 9月だけ・締めた月は無い（beforeEach）ので、締めていない月は 9月の1つ。
 */
const EXPECTED_BODY = { ...EXPECTED_SEPTEMBER, unclosedPastMonths: ['2026-09'] };

// ---------------------------------------------------------------- 確かめるための部品

const prismaMock = prisma as unknown as Record<string, unknown>;
/** モックの prisma の中身のうち、表（モデル）にあたるもの: { findMany: jest.fn(), ... } の形のオブジェクト */
const isModel = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * これまでに呼ばれた DB の操作を、呼ばれた順に並べた名前の一覧（全部の表・$transaction・$executeRaw も入る）。
 *   例: ['allowanceRecord.findMany', 'allowanceItem.findMany', 'allowanceMonthClose.findUnique', 'user.findMany', 'joyoContractor.findMany',
 *        'allowanceRecord.groupBy', 'allowanceMonthClose.findMany']
 */
const dbCalls = (): string[] => {
    const seen: { order: number; name: string }[] = [];
    const collect = (fn: unknown, name: string) => {
        if (!jest.isMockFunction(fn)) return;
        for (const order of fn.mock.invocationCallOrder) seen.push({ order, name });
    };
    for (const [model, value] of Object.entries(prismaMock)) {
        if (isModel(value)) for (const [method, fn] of Object.entries(value)) collect(fn, `${model}.${method}`);
        else collect(value, model);
    }
    return seen.sort((a, b) => a.order - b.order).map((c) => c.name);
};

/**
 * 1回の呼び出しで読むもの（名前順）。読むだけで、何も書かない。
 *   集計:               その月の記録（findMany）・手当・その月の締め（findUnique）・人・支払明細書の対象者
 *   締めていない月:     記録のある日付（groupBy）・締めた月の一覧（allowanceMonthClose.findMany）
 */
const SUMMARY_READS = [
    'allowanceItem.findMany', 'allowanceMonthClose.findMany', 'allowanceMonthClose.findUnique',
    'allowanceRecord.findMany', 'allowanceRecord.groupBy', 'joyoContractor.findMany', 'user.findMany',
];

interface FindArgs { by?: unknown; where?: Record<string, unknown>; orderBy?: unknown; select?: Record<string, unknown> }
/** その findMany・findUnique・groupBy に渡した引数（call 回目。既定は最初） */
const argsOf = (fn: unknown, call = 0) => mock(fn).mock.calls[call][0] as FindArgs;
/** その関数の、いちばん最後の呼び出しに渡した引数 */
const lastArgsOf = (fn: unknown) => mock(fn).mock.calls[mock(fn).mock.calls.length - 1][0] as FindArgs;

beforeEach(() => {
    jest.clearAllMocks();
    // requireAuth の既定のモックには name・username が無いので、テストごとに入れる
    loginAs(ADMIN);

    mock(prisma.allowanceRecord.findMany).mockResolvedValue(RECORDS);
    mock(prisma.allowanceItem.findMany).mockResolvedValue(ITEM_ROWS);
    mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue(null); // 9月は締めていない
    mock(prisma.user.findMany).mockResolvedValue(USERS);
    mock(prisma.joyoContractor.findMany).mockResolvedValue(JOYO_ROWS);
    // 記録のある日付は 9月だけ・締めた月は無い（＝終わったのに締めていない月は、9月の1つ）
    recordDaysAre('2026-09-01', '2026-09-30');
    closedMonthsAre();
    // 公開の設定はオンにしておく（オンでも、職長・作業員には全員の集計を出さないことを確かめるため）
    mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: true, memberNotice: null });
});

afterEach(() => {
    jest.useRealTimers();
    // この API が DB にするのは、集計と「締めていない月」のための読み込みだけ。
    // ほかの表（公開の設定・金額の表・評価ポイントの表）は読まない・何も書かない・トランザクションも開かない
    expect(dbCalls().filter((name) => !SUMMARY_READS.includes(name))).toEqual([]);
});

// ================================================================ ログインと権限

describe('ログインと権限（管理者・マネージャーだけ）', () => {
    it('ログインしていなければ、requireAuth の答え（401）をそのまま返す。何も読まない（集計も、締めていない月も）', async () => {
        const unauthorized = NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        mock(requireAuth).mockResolvedValue({ session: null, error: unauthorized });

        const res = await GET(new NextRequest('http://localhost/api/allowances/summary?month=2026-09'));
        // requireAuth が作った応答そのもの（作り直さない）
        expect(res).toBe(unauthorized);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: '認証が必要です' });
        expect(dbCalls()).toEqual([]);
    });

    it('職長・作業員・協力会社・税理士・応援・ロールの入っていないセッションは 403「権限がありません」。何も読まない（集計も、締めていない月も。公開の設定がオンでも）', async () => {
        for (const user of NOT_MANAGERS) {
            loginAs(user);
            const r = await getSummary();
            expect([user.name, r.status, r.body]).toEqual([user.name, 403, { error: '権限がありません' }]);
        }
        expect(dbCalls()).toEqual([]);
    });

    it('権限の確かめが先: 見られない人には、month が無くても・形が違っていても 403（400 ではない）', async () => {
        loginAs({ id: 'foremanA', role: 'foreman2', name: '職長A' });
        for (const query of ['', 'month=2026-13', 'month=']) {
            const r = await getSummary(query);
            expect([query, r.status, r.body]).toEqual([query, 403, { error: '権限がありません' }]);
        }
        expect(dbCalls()).toEqual([]);
    });

    it('管理者もマネージャーも開ける（同じ答え。大文字のロールでも同じ）', async () => {
        const users: LoginUser[] = [ADMIN, MANAGER, { id: 'admin2', role: 'ADMIN', name: '管理者2' }, { id: 'manager2', role: 'Manager', name: 'マネージャー2' }];
        for (const user of users) {
            loginAs(user);
            const r = await getSummary();
            expect([user.role, r.status]).toEqual([user.role, 200]);
            expect(r.body).toEqual(EXPECTED_BODY);
        }
    });
});

// ================================================================ 月の指定

describe('月の指定（month は必須）', () => {
    it('month が無い → 400「入力が不正です」。何も読まない（締めていない月も）', async () => {
        for (const query of ['', 'startDate=2026-09-01&endDate=2026-09-30', 'date=2026-09-10', 'Month=2026-09']) {
            const r = await getSummary(query);
            expect([query, r.status, r.body.error, r.body.details]).toEqual([query, 400, 'Validation Error', '入力が不正です']);
        }
        expect(dbCalls()).toEqual([]);
    });

    it("month の形が違う（'2026-13'・'2026-9'・'202609'・日付 など）→ 400「月が不正です」。何も読まない（締めていない月も）", async () => {
        for (const month of ['2026-13', '2026-00', '2026-9', '202609', '2026/09', '2026-09-01', '2026-09-', ' 2026-09', '2026-09 ', '２０２６-０９', '９月', 'abc', '']) {
            const r = await getMonth(month);
            expect([month, r.status, r.body.error, r.body.details]).toEqual([month, 400, 'Validation Error', '月が不正です']);
        }
        expect(dbCalls()).toEqual([]);
    });

    it("年が 2000〜2999 でない月（'0026-09'・'1999-12'・'3000-01'）→ 400「月が不正です」。何も読まない（別の月を集計してしまわない）", async () => {
        // '0026-09' は、Date が 1926年9月と読む。受け付けると、頼んだ月とは別の月（1926-09）の集計を返してしまう
        for (const month of ['0026-09', '0000-01', '1999-12', '3000-01', '9999-12']) {
            const r = await getMonth(month);
            expect([month, r.status, r.body.details]).toEqual([month, 400, '月が不正です']);
        }
        expect(dbCalls()).toEqual([]);
    });

    it('頼んだ月の範囲（月の1日 〜 翌月1日より前。UTC 0時の印）の記録と、その月の締めを読む（年をまたぐ12月・うるう年の2月も）', async () => {
        const cases: [string, string, string, string][] = [
            // 月,       1日,          末日,         翌月1日（記録を読む範囲の終わり）
            ['2026-09', '2026-09-01', '2026-09-30', '2026-10-01'],
            ['2026-12', '2026-12-01', '2026-12-31', '2027-01-01'],
            ['2024-02', '2024-02-01', '2024-02-29', '2024-03-01'],
            ['2026-02', '2026-02-01', '2026-02-28', '2026-03-01'],
        ];
        for (const [month, start, end, next] of cases) {
            jest.clearAllMocks();
            const r = await getMonth(month);
            expect([r.status, r.body.month, r.body.startDate, r.body.endDate]).toEqual([200, month, start, end]);
            expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
            // 月だけで絞る（人・手当・状態では絞らない）
            expect(argsOf(prisma.allowanceRecord.findMany).where).toEqual({ date: { gte: utc0(start), lt: utc0(next) } });
            expect(argsOf(prisma.allowanceMonthClose.findUnique).where).toEqual({ month });
        }
    });
});

// ================================================================ 応答

describe('応答: loadAllowanceSummary(month) の答え ＋ unclosedPastMonths', () => {
    it('具体的な例（職長・作業員・常用の一人親方・確認待ち・辞めた人の記録）の集計を、そのまま返す（200・Cache-Control: no-store）', async () => {
        const r = await getSummary();
        expect(r.status).toBe(200);
        expect(r.cache).toBe('no-store');
        // 集計（EXPECTED_SEPTEMBER）に、unclosedPastMonths: ['2026-09'] を足したもの
        expect(r.body).toEqual(EXPECTED_BODY);
        expect(serverErrorResponse).not.toHaveBeenCalled();
    });

    it('集計の部分は、loadAllowanceSummary(month) を直接呼んだ答えと同じ（CSV の集計と同じ関数＝同じ人・同じ並び・同じ数字）。足すのは unclosedPastMonths の1つだけ', async () => {
        for (const month of ['2026-09', '2026-12']) {
            const { body } = await getMonth(month);
            const direct = await loadAllowanceSummary(month);
            if (!direct) throw new Error(`月の集計が null で返りました: ${month}`);
            // 応答は JSON になるので、直接呼んだ答えも JSON にしてから比べる
            expect(body).toEqual({ ...JSON.parse(JSON.stringify(direct)), unclosedPastMonths: ['2026-09'] });
            expect(Object.keys(body).sort()).toEqual([...Object.keys(direct), 'unclosedPastMonths'].sort());
        }
    });

    it('people: この月に記録のある人だけ（辞めた人も出す・記録の無い在籍者は出さない）。並びは dispatchSortOrder の小さい順 → null は最後', async () => {
        const { body } = await getSummary();
        expect(body.people?.map((p) => [p.userId, p.displayName, p.role])).toEqual([
            ['foremanA', '職長A', 'foreman2'],              // 1
            ['worker1', '作業員1', 'worker'],               // 2
            ['retired', '辞めた作業員', 'worker'],           // 3（在籍していないが、記録がある）
            ['joyo1', '常用の親方1', 'worker'],              // 5
            ['worker2', 'あおき（作業員2）', 'worker'],      // 並び順が無い（null）
        ]);
        // 在籍していても、記録の無い人（管理者・マネージャー・記録の無い一人親方・協力会社のメンバー）は出ない
        for (const id of ['admin1', 'manager1', 'joyo2', 'pm1']) {
            expect([id, body.people?.some((p) => p.userId === id)]).toEqual([id, false]);
        }

        // 記録の並び・User の並びを逆にしても、同じ答え
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([...RECORDS].reverse());
        mock(prisma.user.findMany).mockResolvedValue([...USERS].reverse());
        expect((await getSummary()).body).toEqual(EXPECTED_BODY);
    });

    it('人ごとの数字: 職長・職長以外の日数と金額。確認待ちは合計に入れない（件数と金額は別に出す）', async () => {
        const { body } = await getSummary();
        const foremanA = body.people?.find((p) => p.userId === 'foremanA');
        // 確定は 職長 1,500円 × 2日 ＋ 職長以外 200円 × 1日 ＝ 3,200円・3日。確認待ちの 1,500円・1件は入っていない
        expect(foremanA).toMatchObject({
            foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200,
            totalDays: 3, totalAmount: 3200, pendingCount: 1, pendingAmount: 1500,
        });
        expect(body.totals).toMatchObject({ totalDays: 11, totalAmount: 4700, pendingCount: 1, pendingAmount: 1500 });

        // 確認待ちを認めたあと（同じ記録が確定になった）は、合計に入る
        mock(prisma.allowanceRecord.findMany).mockResolvedValue(RECORDS.map((r) => ({ ...r, status: 'confirmed' })));
        const confirmed = (await getSummary()).body;
        expect(confirmed.people?.find((p) => p.userId === 'foremanA')).toMatchObject({
            foremanDays: 3, foremanAmount: 4500, totalDays: 4, totalAmount: 4700, pendingCount: 0, pendingAmount: 0,
        });
        expect(confirmed.totals).toMatchObject({ totalDays: 12, totalAmount: 6200, pendingCount: 0, pendingAmount: 0 });
    });

    it('isJoyo・totalsByKind: 支払明細書の対象者に登録されている人が「常用の一人親方」。社員の合計と分けて出し、足すと全体の合計になる', async () => {
        const { body } = await getSummary();
        expect(Object.fromEntries((body.people ?? []).map((p) => [p.userId, p.isJoyo]))).toEqual({
            foremanA: false, worker1: false, retired: false, joyo1: true, worker2: false,
        });
        expect(body.totalsByKind).toEqual(EXPECTED_SEPTEMBER.totalsByKind);
        for (const key of TOTAL_KEYS) {
            expect([key, (body.totalsByKind?.employee[key] ?? NaN) + (body.totalsByKind?.joyo[key] ?? NaN)]).toEqual([key, body.totals?.[key]]);
            expect([key, (body.people ?? []).reduce((sum, p) => sum + p[key], 0)]).toEqual([key, body.totals?.[key]]);
        }

        // 登録されている人が変われば、分け方も変わる（職長A が一人親方なら、確認待ちも一人親方の側）
        mock(prisma.joyoContractor.findMany).mockResolvedValue([{ userId: 'foremanA' }]);
        const other = (await getSummary()).body;
        expect(other.people?.filter((p) => p.isJoyo).map((p) => p.userId)).toEqual(['foremanA']);
        expect(other.totalsByKind).toEqual({
            employee: { foremanDays: 0, foremanAmount: 0, memberDays: 8, memberAmount: 1500, totalDays: 8, totalAmount: 1500, pendingCount: 0, pendingAmount: 0 },
            joyo: { foremanDays: 2, foremanAmount: 3000, memberDays: 1, memberAmount: 200, totalDays: 3, totalAmount: 3200, pendingCount: 1, pendingAmount: 1500 },
        });
        expect(other.totals).toEqual(EXPECTED_SEPTEMBER.totals);
    });

    it('締めた月でも、社員／一人親方の分け方は「今の登録」で決まる（あとから登録すると totalsByKind は変わる。人ごとの日数と金額・全体の合計は変わらない）', async () => {
        // 9月を締めてある
        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue({ closedByName: '管理者1', closedAt: new Date('2026-10-02T01:23:45.678Z') });
        closedMonthsAre('2026-09');
        const before = (await getSummary()).body;
        expect(before.closed).toEqual({ closedByName: '管理者1', closedAt: '2026-10-02T01:23:45.678Z' });
        expect(before.totalsByKind).toEqual(EXPECTED_SEPTEMBER.totalsByKind);

        // 締めたあとで、作業員1 を、支払明細書の対象者（常用の一人親方）に登録した
        mock(prisma.joyoContractor.findMany).mockResolvedValue([...JOYO_ROWS, { userId: 'worker1' }]);
        const after = (await getSummary()).body;
        // 作業員1 の 3日・600円が、社員の側から、一人親方の側へ移る
        expect(after.totalsByKind).toEqual({
            employee: { foremanDays: 2, foremanAmount: 3000, memberDays: 4, memberAmount: 700, totalDays: 6, totalAmount: 3700, pendingCount: 1, pendingAmount: 1500 },
            joyo: { foremanDays: 0, foremanAmount: 0, memberDays: 5, memberAmount: 1000, totalDays: 5, totalAmount: 1000, pendingCount: 0, pendingAmount: 0 },
        });
        // 変わるのは「どちらの側か」だけ。人ごとの日数と金額・全体の合計は、締めたときのまま
        expect(after.totals).toEqual(before.totals);
        const withoutKind = (people: SummaryBody['people']) => (people ?? []).map((p) => ({ ...p, isJoyo: null }));
        expect(withoutKind(after.people)).toEqual(withoutKind(before.people));
        expect(after.people?.filter((p) => p.isJoyo).map((p) => p.userId)).toEqual(['worker1', 'joyo1']);
    });

    it('items: 使用中の手当 ＋ この月に記録のある手当（使っていなくて、記録も無い手当は出さない）', async () => {
        const { body } = await getSummary();
        expect(body.items).toEqual([
            { id: 'large', name: '大規模手当', isActive: true },
            { id: 'old', name: '旧手当', isActive: false },
            { id: 'spare', name: '予備の手当', isActive: true },
        ]);
        // 手当は、使っていないものも含めて、並び順（sortOrder → 作った順）で読む
        expect(argsOf(prisma.allowanceItem.findMany).where).toBeUndefined();
        expect(argsOf(prisma.allowanceItem.findMany).orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
    });

    it('closed: その月の締めの行があれば「締めた人・締めた日時（ISO 文字列）」、無ければ null（数字は同じ）', async () => {
        expect((await getSummary()).body.closed).toBeNull();

        // 9月を締めた（その月の締めの行がある・締めた月の一覧にも 9月が入る）
        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue({ closedByName: '管理者1', closedAt: new Date('2026-10-02T01:23:45.678Z') });
        closedMonthsAre('2026-09');
        const { body } = await getSummary();
        expect(body.closed).toEqual({ closedByName: '管理者1', closedAt: '2026-10-02T01:23:45.678Z' });
        // 変わるのは closed と、締めていない月（9月が消える）だけ。人ごとの数字・合計は同じ
        expect(body).toEqual({
            ...EXPECTED_SEPTEMBER,
            closed: { closedByName: '管理者1', closedAt: '2026-10-02T01:23:45.678Z' },
            unclosedPastMonths: [],
        });
    });

    it('eligiblePeople: 在籍していて、手当をもらえるロールの全員（記録が無くても）。協力会社のメンバー・辞めた人は入らない。role は小文字', async () => {
        const { body } = await getSummary();
        expect(body.eligiblePeople).toEqual(EXPECTED_SEPTEMBER.eligiblePeople);
        for (const id of ['pm1', 'retired']) {
            expect([id, body.eligiblePeople?.some((p) => p.userId === id)]).toEqual([id, false]);
        }
    });

    it('人は「在籍している人 または 記録のある人」を、ロールで絞らずに読む。支払明細書の対象者は、読めた人と記録のある人の ID で引く', async () => {
        await getSummary();
        expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        const userWhere = argsOf(prisma.user.findMany).where as { OR: [unknown, { id: { in: string[] } }] };
        expect(userWhere).toEqual({ OR: [{ isActive: true }, { id: { in: expect.any(Array) } }] });
        expect(sorted(userWhere.OR[1].id.in)).toEqual(sorted(RECORD_USER_IDS));

        expect(prisma.joyoContractor.findMany).toHaveBeenCalledTimes(1);
        const joyoWhere = argsOf(prisma.joyoContractor.findMany).where as { userId: { in: string[] } };
        // 「使わない」になっている対象者も、一人親方として数える（isActive では絞らない）
        expect(joyoWhere).toEqual({ userId: { in: expect.any(Array) } });
        expect(sorted(joyoWhere.userId.in)).toEqual(sorted(USERS.map((u) => u.id)));
    });

    it('確認待ちだけの人も people に出す（合計は 0。確認待ちの件数と金額だけ）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            rec('worker1', 'member', 200),
            rec('foremanA', 'foreman', 1500, 'pending'),
        ]);
        const { body } = await getSummary();
        expect(body.people).toEqual([
            {
                userId: 'foremanA', displayName: '職長A', role: 'foreman2', isJoyo: false, byItem: {},
                foremanDays: 0, foremanAmount: 0, memberDays: 0, memberAmount: 0,
                totalDays: 0, totalAmount: 0, pendingCount: 1, pendingAmount: 1500,
            },
            {
                userId: 'worker1', displayName: '作業員1', role: 'worker', isJoyo: false,
                byItem: { large: { foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 200 } },
                foremanDays: 0, foremanAmount: 0, memberDays: 1, memberAmount: 200,
                totalDays: 1, totalAmount: 200, pendingCount: 0, pendingAmount: 0,
            },
        ]);
        expect(body.totals).toEqual({ ...ZERO_TOTALS, memberDays: 1, memberAmount: 200, totalDays: 1, totalAmount: 200, pendingCount: 1, pendingAmount: 1500 });
    });

    it('同じ並び順・同じ名前の2人は、人の ID 順に並ぶ（記録の並び・User の並びによらず、毎回同じ）', async () => {
        const twins = [
            { id: 'twinB', displayName: 'ふたご', role: 'WORKER', isActive: true, dispatchSortOrder: 3 },
            { id: 'twinA', displayName: 'ふたご', role: 'worker', isActive: true, dispatchSortOrder: 3 },
        ];
        const records = [rec('twinB', 'member', 200), rec('twinA', 'member', 200)];
        for (const recordRows of [records, [...records].reverse()]) {
            for (const userRows of [twins, [...twins].reverse()]) {
                mock(prisma.allowanceRecord.findMany).mockResolvedValue(recordRows);
                mock(prisma.user.findMany).mockResolvedValue(userRows);
                const { body } = await getSummary();
                expect(body.people?.map((p) => p.userId)).toEqual(['twinA', 'twinB']);
                expect(body.eligiblePeople?.map((p) => p.userId)).toEqual(['twinA', 'twinB']);
            }
        }
    });

    it('User の行が無い人（消された人）の記録は「（不明）」で出す。支払明細書の対象者に登録されていれば、一人親方の側に数える', async () => {
        // ghost は User の行が無い（消された）一人親方: 職長以外 2日。作業員1: 職長以外 1日
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            rec('ghost', 'member', 200),
            rec('worker1', 'member', 200),
            rec('ghost', 'member', 200),
        ]);
        mock(prisma.user.findMany).mockResolvedValue(USERS.filter((u) => u.id === 'worker1'));
        mock(prisma.joyoContractor.findMany).mockResolvedValue([{ userId: 'ghost' }]);

        const { body } = await getSummary();
        expect(body.people?.map((p) => [p.userId, p.displayName, p.role, p.isJoyo, p.totalDays, p.totalAmount])).toEqual([
            ['worker1', '作業員1', 'worker', false, 1, 200],
            ['ghost', '（不明）', '', true, 2, 400],
        ]);
        // 支払明細書の対象者は、User の行が無い人の ID でも引く（社員の合計に入ってしまわないように）
        const joyoWhere = argsOf(prisma.joyoContractor.findMany).where as { userId: { in: string[] } };
        expect(sorted(joyoWhere.userId.in)).toEqual(['ghost', 'worker1']);
        expect(body.totalsByKind).toEqual({
            employee: { ...ZERO_TOTALS, memberDays: 1, memberAmount: 200, totalDays: 1, totalAmount: 200 },
            joyo: { ...ZERO_TOTALS, memberDays: 2, memberAmount: 400, totalDays: 2, totalAmount: 400 },
        });
        // 「記録を足す」で選べる人には、User の行が無い人は出ない
        expect(body.eligiblePeople?.map((p) => p.userId)).toEqual(['worker1']);
    });

    it('記録が無い月: people は空・合計は全部 0・items は使用中の手当だけ。eligiblePeople は、記録が無くても出す', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);
        // 記録のある人を読まないので、辞めた人は DB から返ってこない
        mock(prisma.user.findMany).mockResolvedValue(USERS.filter((u) => u.isActive));
        const r = await getMonth('2026-08');
        expect(r.status).toBe(200);
        expect(r.body).toEqual({
            month: '2026-08', startDate: '2026-08-01', endDate: '2026-08-31',
            closed: null,
            items: [{ id: 'large', name: '大規模手当', isActive: true }, { id: 'spare', name: '予備の手当', isActive: true }],
            people: [],
            totals: ZERO_TOTALS,
            totalsByKind: { employee: ZERO_TOTALS, joyo: ZERO_TOTALS },
            eligiblePeople: EXPECTED_SEPTEMBER.eligiblePeople,
            // 開いた月（8月）に記録が無くても、締めていない月（9月）は知らせる
            unclosedPastMonths: ['2026-09'],
        });
        expect(argsOf(prisma.user.findMany).where).toEqual({ isActive: true });
    });
});

// ================================================================ 終わったのに締めていない月

describe('unclosedPastMonths: 終わったのに締めていない月（今月より前で、記録があって、締めていない月。古い順）', () => {
    /** 日本時間 2026-10-04 12:00（今月は 10月） */
    const OCT_4_NOON_JST = '2026-10-04T03:00:00.000Z';

    it('今月（日本時間）より前で、記録があって、締めていない月を、古い順に返す。今月・先の月・締めた月は入らない', async () => {
        freezeNow(OCT_4_NOON_JST);
        // DB に入っている記録の日付（並びは、ばらばら）: 去年の12月・7月・8月・9月・今月（10月）・先の月（11月）
        recordDaysInDb('2026-09-30', '2026-07-01', '2026-10-01', '2026-08-15', '2026-09-01', '2025-12-31', '2026-10-03', '2026-11-05', '2026-07-31');
        // 締めた月: 8月（記録あり）と、6月（記録なし）
        closedMonthsAre('2026-08', '2026-06');

        const { status, body } = await getSummary();
        expect(status).toBe(200);
        // 12月（去年）・7月・9月。8月は締めてある・10月は今月・11月は先の月なので、入らない。同じ月は1回だけ
        expect(body.unclosedPastMonths).toEqual(['2025-12', '2026-07', '2026-09']);
        // 集計の部分は変わらない
        expect({ ...body, unclosedPastMonths: ['2026-09'] }).toEqual(EXPECTED_BODY);
    });

    it("記録のある日付は「日付ごとに1行にまとめて、今月の1日（UTC 0時の印）より前だけ」を読む（by: ['date']・where は日付だけ）。締めた月は、全部を読む", async () => {
        freezeNow(OCT_4_NOON_JST);
        expect((await getSummary()).status).toBe(200);

        expect(prisma.allowanceRecord.groupBy).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceRecord.groupBy).by).toEqual(['date']);
        // 絞るのは日付だけ（人・手当・状態では絞らない＝確認待ちだけの月も「記録のある月」）
        expect(argsOf(prisma.allowanceRecord.groupBy).where).toEqual({ date: { lt: utc0('2026-10-01') } });

        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(1);
        // 月で絞らない（古い月の締めも、全部を見る）
        expect(argsOf(prisma.allowanceMonthClose.findMany).where).toBeUndefined();
        expect(argsOf(prisma.allowanceMonthClose.findMany).select).toMatchObject({ month: true });
    });

    it('月の境目は日本時間: 日本時間で月が変わった瞬間から、前の月が「終わった月」になる（UTC では、まだ前の月でも）', async () => {
        recordDaysInDb('2026-08-31', '2026-09-01', '2026-09-30');

        freezeNow('2026-09-30T14:59:59.000Z'); // 日本時間 9/30 23:59:59（まだ 9月）
        const before = await getSummary();
        expect(before.body.unclosedPastMonths).toEqual(['2026-08']);
        expect(lastArgsOf(prisma.allowanceRecord.groupBy).where).toEqual({ date: { lt: utc0('2026-09-01') } });

        freezeNow('2026-09-30T15:00:00.000Z'); // 日本時間 10/1 0:00（UTC では、まだ 9/30）
        const after = await getSummary();
        expect(after.body.unclosedPastMonths).toEqual(['2026-08', '2026-09']);
        expect(lastArgsOf(prisma.allowanceRecord.groupBy).where).toEqual({ date: { lt: utc0('2026-10-01') } });
    });

    it('年をまたぐとき: 日本時間で 1月1日になった瞬間から、前の年の12月が「終わった月」になる', async () => {
        recordDaysInDb('2026-12-31', '2027-01-01');

        freezeNow('2026-12-31T14:59:59.000Z'); // 日本時間 12/31 23:59:59
        expect((await getSummary()).body.unclosedPastMonths).toEqual([]);
        expect(lastArgsOf(prisma.allowanceRecord.groupBy).where).toEqual({ date: { lt: utc0('2026-12-01') } });

        freezeNow('2026-12-31T15:00:00.000Z'); // 日本時間 2027-01-01 0:00
        expect((await getSummary()).body.unclosedPastMonths).toEqual(['2026-12']);
        expect(lastArgsOf(prisma.allowanceRecord.groupBy).where).toEqual({ date: { lt: utc0('2027-01-01') } });
    });

    it('開いた月（month）には関係ない: どの月を開いても、同じ「締めていない月」を返す（今月・先の月・締めた月を開いても）', async () => {
        freezeNow(OCT_4_NOON_JST);
        recordDaysInDb('2026-08-15', '2026-09-10', '2026-10-02');
        closedMonthsAre('2026-08');
        for (const month of ['2026-09', '2026-08', '2026-10', '2025-01', '2099-12']) {
            mock(prisma.allowanceRecord.groupBy).mockClear();
            const { status, body } = await getMonth(month);
            expect([month, status, body.month, body.unclosedPastMonths]).toEqual([month, 200, month, ['2026-09']]);
            // 「今月より前」の境目は、開いた月ではなく、今日（日本時間）で決まる
            expect([month, argsOf(prisma.allowanceRecord.groupBy).where]).toEqual([month, { date: { lt: utc0('2026-10-01') } }]);
        }
    });

    it('記録が無い・記録のある月を全部締めてあるなら、空の配列（null にはしない）', async () => {
        freezeNow(OCT_4_NOON_JST);
        recordDaysInDb();
        expect((await getSummary()).body.unclosedPastMonths).toEqual([]);

        recordDaysInDb('2026-08-15', '2026-09-30', '2026-10-01');
        closedMonthsAre('2026-09', '2026-08');
        expect((await getSummary()).body.unclosedPastMonths).toEqual([]);
    });

    it('応答の unclosedPastMonths は、loadUnclosedPastMonths() を直接呼んだ答えと同じ（「今日」を渡さない＝日本時間の今日で決める）', async () => {
        freezeNow(OCT_4_NOON_JST);
        recordDaysInDb('2026-09-30', '2026-07-01', '2026-10-01');
        const { body } = await getSummary();
        expect(body.unclosedPastMonths).toEqual(await loadUnclosedPastMonths());
        expect(body.unclosedPastMonths).toEqual(['2026-07', '2026-09']);
    });
});

// ================================================================ 読むもの・例外・設定

describe('読むもの・例外・設定', () => {
    it('読むのは、集計のための5つ（その月の記録・手当・その月の締め・人・支払明細書の対象者）と、締めていない月のための2つ（記録のある日付・締めた月）だけ（1回ずつ。何も書かない）', async () => {
        expect((await getSummary()).status).toBe(200);
        expect(sorted(dbCalls())).toEqual(SUMMARY_READS);
    });

    it('記録を読むときに例外が起きたら 500（何の操作で起きたかと、起きた例外を serverErrorResponse に渡す）', async () => {
        const boom = new Error('DB に届かない');
        mock(prisma.allowanceRecord.findMany).mockRejectedValue(boom);
        const r = await getSummary();
        expect(r.status).toBe(500);
        expect(r.body.people).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledTimes(1);
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の集計の取得', boom);
    });

    it('人・支払明細書の対象者を読むときに例外が起きても 500（途中までの集計を返してしまわない）', async () => {
        const boom = new Error('DB に届かない');
        mock(prisma.user.findMany).mockRejectedValue(boom);
        const byUser = await getSummary();
        expect([byUser.status, byUser.body.people, byUser.body.totals]).toEqual([500, undefined, undefined]);

        mock(prisma.user.findMany).mockResolvedValue(USERS);
        mock(prisma.joyoContractor.findMany).mockRejectedValue(boom);
        const byJoyo = await getSummary();
        expect([byJoyo.status, byJoyo.body.people, byJoyo.body.totals]).toEqual([500, undefined, undefined]);
        expect(serverErrorResponse).toHaveBeenCalledTimes(2);
    });

    it('締めていない月を読むとき（記録のある日付・締めた月の一覧）に例外が起きても 500（締めていない月を「無い」ことにして、集計だけを返さない）', async () => {
        const boom = new Error('DB に届かない');
        mock(prisma.allowanceRecord.groupBy).mockRejectedValue(boom);
        const byDays = await getSummary();
        expect([byDays.status, byDays.body.people, byDays.body.unclosedPastMonths]).toEqual([500, undefined, undefined]);
        expect(serverErrorResponse).toHaveBeenLastCalledWith('手当の集計の取得', boom);

        recordDaysAre('2026-09-01');
        mock(prisma.allowanceMonthClose.findMany).mockRejectedValue(boom);
        const byClosed = await getSummary();
        expect([byClosed.status, byClosed.body.people, byClosed.body.unclosedPastMonths]).toEqual([500, undefined, undefined]);
        expect(serverErrorResponse).toHaveBeenCalledTimes(2);
    });

    it("毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'）", () => {
        expect(dynamic).toBe('force-dynamic');
    });
});
