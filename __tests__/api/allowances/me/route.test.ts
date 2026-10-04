/**
 * @jest-environment node
 *
 * GET /api/allowances/me?month=YYYY-MM（本人の、その月の手当）のテスト。
 *
 *   見られる人: 「手当」の画面の見せ方が 'manager'（admin・manager）か 'member'（worker・foreman1・foreman2 で、公開の設定がオン）の人。
 *               'none'（公開の設定がオフの職長・作業員、協力会社 など）は 403。
 *   返すもの:   ログインしている本人の記録だけ（userId は、必ずセッションから取る）。付けた人の名前・メモは返さない。
 *
 * route は lib/allowancesServer.ts の resolveAllowanceAccessMode()・lib/allowancesReport.ts の loadMyAllowance() を本物のまま呼ぶ。
 * 差し替えているのは、jest.setup.ts の @/lib/prisma と @/lib/api/utils だけ
 * （prisma のモックは where を見ずに、テストが決めた答えを返すだけ）。
 * だから「本人の記録だけか」は、返ってきた値ではなく、allowanceRecord.findMany に渡した where の userId がセッションの ID であることで確かめる。
 *
 * いちばん守りたい約束:
 *   - 読むのは、セッションの ID の人の記録だけ（クエリに ほかの人の ID を付けても変わらない。ID の無いセッションは断る）
 *   - 見られない人（公開の設定がオフの職長・作業員 など）には、記録を読まずに 403
 *   - 確認待ちは合計に入れない。付けた人の名前・メモは出さない
 *
 * 日付: 過去の決まった月（2026年9月 など）を使う。この API は時計を見ない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, dynamic } from '@/app/api/allowances/me/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import type { MyAllowanceResponse } from '@/lib/allowancesReport';

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

// ---------------------------------------------------------------- ログインしている人

interface LoginUser { id?: string | null; role?: string | null; name?: string }
/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: LoginUser, username = `login-${user.id}`) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username, ...user } }, error: null });

const ADMIN: LoginUser = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER: LoginUser = { id: 'manager1', role: 'manager', name: 'マネージャー1' };
const FOREMAN_A: LoginUser = { id: 'foremanA', role: 'foreman2', name: '職長A' };
const FOREMAN_B: LoginUser = { id: 'foremanB', role: 'foreman1', name: '職長B' };
const WORKER: LoginUser = { id: 'worker1', role: 'worker', name: '作業員1' };

/** 公開の設定がオンのときだけ見られる人（職長・作業員） */
const MEMBERS = [WORKER, FOREMAN_B, FOREMAN_A];
/** 公開の設定がオンでも見られない人（手当の対象でないロール・ロールの入っていないセッション） */
const OUTSIDERS: LoginUser[] = [
    { id: 'partner1', role: 'partner', name: '協力会社' },
    { id: 'pm1', role: 'partner_member', name: '協力会社のメンバー' },
    { id: 'accountant1', role: 'accountant', name: '税理士' },
    { id: 'support1', role: 'support', name: '応援' },
    { id: 'nobody1', role: '', name: 'ロールが空' },
    { id: 'nobody2', role: null, name: 'ロールが null' },
    { id: 'nobody3', name: 'ロールが無い' },
];

// ---------------------------------------------------------------- 公開の設定

const NOTICE = '手当は、翌月の給与といっしょに支払います';

/**
 * 手当の公開の設定（AllowanceSetting の1行）を決める。row が null なら、行が無い。
 * 評価ポイントの公開の設定は、いつも「その逆」にしておく
 * （手当を見られるかどうかが、評価ポイントの設定に引きずられたら、答えが変わって気づけるように）。
 */
const setting = (row: { showToMembers: boolean; memberNotice: string | null } | null) => {
    mock(prisma.allowanceSetting.findUnique).mockResolvedValue(row);
    mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue({ showToMembers: !(row?.showToMembers ?? false), memberNotice: '評価ポイントの注意書き' });
};

// ---------------------------------------------------------------- 呼び方と、応答の読み方

type MeBody = Partial<MyAllowanceResponse> & { error?: string; details?: string };

/** GET /me を呼ぶ。query は '?' の後ろ（既定は 2026年9月） */
const getMe = async (query = 'month=2026-09') => {
    const res = await GET(new NextRequest(`http://localhost/api/allowances/me${query === '' ? '' : `?${query}`}`));
    return { status: res.status, body: (await res.json()) as MeBody, cache: res.headers.get('Cache-Control') };
};
/** month の値を、そのまま（空白や記号も）クエリに入れて呼ぶ */
const getMonth = (month: string) => getMe(new URLSearchParams({ month }).toString());

/** 形のまちがい（validationErrorResponse）は、モックでは文言が details に入る。権限で断るもの（errorResponse）は error に入る */
const messageOf = (r: { body: MeBody }) => r.body.details ?? r.body.error;

// ---------------------------------------------------------------- DB の中身（モックが返すもの）

/**
 * 本人（職長A）の記録の1行。
 * 読む列に入っていない列（付けた人・認めた人・メモ・入力元 など）も、わざと入れてある。
 * どの行にも同じ値を入れた「目印」で、DB から読めてしまっても、応答に出てこないことを確かめるためのもの
 */
const myRow = (id: string, dateKey: string, payRole: string, amount: number, status = 'confirmed') => ({
    id, date: utc0(dateKey), itemId: 'large', itemName: '大規模手当', payRole, amount, status,
    userId: 'foremanA', source: 'attendance', foremanId: 'foremanA', rateId: 'rate1',
    createdBy: 'admin1', createdByName: '管理者1', confirmedByName: 'マネージャー1', note: 'ひみつのメモ',
});

/**
 * 2026年9月の、職長A の記録（DB が「日付の古い順 → 付けた順」で返したあとの結果）。
 *   職長として 2日（1,500円）・ほかの人の班に入った日 2日（200円）・自分で付けた確認待ち 1件（1,500円）
 */
const MY_ROWS = [
    myRow('m1', '2026-09-01', 'member', 200),               // ほかの人の班に入った日
    myRow('m2', '2026-09-02', 'foreman', 1500),
    myRow('m3', '2026-09-10', 'member', 200),
    myRow('m4', '2026-09-20', 'foreman', 1500, 'pending'),  // 自分で付けた分（確認待ち）
    myRow('m5', '2026-09-30', 'foreman', 1500),
];

// ---------------------------------------------------------------- 確かめるための部品

const prismaMock = prisma as unknown as Record<string, unknown>;
/** モックの prisma の中身のうち、表（モデル）にあたるもの: { findMany: jest.fn(), ... } の形のオブジェクト */
const isModel = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * これまでに呼ばれた DB の操作を、呼ばれた順に並べた名前の一覧（全部の表・$transaction・$executeRaw も入る）。
 *   例: ['allowanceSetting.findUnique', 'allowanceRecord.findMany', 'allowanceMonthClose.findUnique']
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

const SETTING_READ = 'allowanceSetting.findUnique';
const RECORD_READ = 'allowanceRecord.findMany';
const CLOSE_READ = 'allowanceMonthClose.findUnique';

/** 公開の設定のほかに読んだもの（記録・締め など）。断るときは、これが空のはず */
const readsBeyondSetting = () => dbCalls().filter((name) => name !== SETTING_READ);

interface FindArgs { where?: Record<string, unknown>; orderBy?: unknown; select?: Record<string, unknown> }
/** 記録を読んだときの引数（call 回目。既定は最初） */
const recordArgs = (call = 0) => mock(prisma.allowanceRecord.findMany).mock.calls[call][0] as FindArgs;

/** 2026年9月の範囲（@db.Date の列を絞る形: 月の1日（UTC 0時）以上・翌月1日より前） */
const SEPTEMBER = { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') };

beforeEach(() => {
    jest.clearAllMocks();
    // requireAuth の既定のモックには name・username が無いので、テストごとに入れる
    loginAs(FOREMAN_A);
    setting({ showToMembers: true, memberNotice: NOTICE });               // 公開の設定はオン
    mock(prisma.allowanceRecord.findMany).mockResolvedValue(MY_ROWS);
    mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue(null);  // 締めていない
});

afterEach(() => {
    // この API が DB にするのは「公開の設定・本人の記録・その月の締め」を読むことだけ。
    // ほかの表（評価ポイントの表も）は読まない・何も書かない・トランザクションも開かない
    const allowed = new Set([SETTING_READ, RECORD_READ, CLOSE_READ]);
    expect(dbCalls().filter((name) => !allowed.has(name))).toEqual([]);
});

// ================================================================ ログインと権限

describe('ログインと、見られる人', () => {
    it('ログインしていなければ、requireAuth の答え（401）をそのまま返す。DB は読まない', async () => {
        const unauthorized = NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        mock(requireAuth).mockResolvedValue({ session: null, error: unauthorized });

        const res = await GET(new NextRequest('http://localhost/api/allowances/me?month=2026-09'));
        // requireAuth が作った応答そのもの（作り直さない）
        expect(res).toBe(unauthorized);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: '認証が必要です' });
        expect(dbCalls()).toEqual([]);
    });

    it('公開の設定がオフのとき、worker・foreman1・foreman2 は 403「権限がありません」。記録は読まない', async () => {
        setting({ showToMembers: false, memberNotice: NOTICE });
        for (const user of MEMBERS) {
            loginAs(user);
            const r = await getMe();
            expect([user.role, r.status, r.body]).toEqual([user.role, 403, { error: '権限がありません' }]);
        }
        expect(readsBeyondSetting()).toEqual([]);
    });

    it('公開の設定の行が無いときも、worker・foreman1・foreman2 は 403（行が無くても、見える側には倒さない）。記録は読まない', async () => {
        setting(null);
        for (const user of MEMBERS) {
            loginAs(user);
            const r = await getMe();
            expect([user.role, r.status, r.body]).toEqual([user.role, 403, { error: '権限がありません' }]);
        }
        expect(readsBeyondSetting()).toEqual([]);
    });

    it('協力会社・協力会社のメンバー・税理士・応援・ロールの入っていないセッションは、公開の設定がオンでも 403。DB は読まない', async () => {
        setting({ showToMembers: true, memberNotice: NOTICE });
        for (const user of OUTSIDERS) {
            loginAs(user);
            const r = await getMe();
            expect([user.name, r.status, r.body]).toEqual([user.name, 403, { error: '権限がありません' }]);
        }
        // 対象でないロールは、公開の設定も読まずに断る
        expect(dbCalls()).toEqual([]);
    });

    it('公開の設定がオンなら、worker・foreman1・foreman2 は見られる（読むのは、自分の ID の記録）', async () => {
        setting({ showToMembers: true, memberNotice: NOTICE });
        for (const user of MEMBERS) {
            mock(prisma.allowanceRecord.findMany).mockClear();
            loginAs(user);
            const r = await getMe();
            expect([user.role, r.status, r.body.month]).toEqual([user.role, 200, '2026-09']);
            expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
            expect([user.role, recordArgs().where]).toEqual([user.role, { userId: user.id, date: SEPTEMBER }]);
        }
    });

    it('admin・manager は、公開の設定がオフでも・行が無くても見られる（読むのは、自分の ID の記録）', async () => {
        for (const row of [{ showToMembers: false, memberNotice: null }, null]) {
            setting(row);
            for (const user of [ADMIN, MANAGER]) {
                mock(prisma.allowanceRecord.findMany).mockClear();
                loginAs(user);
                const r = await getMe();
                expect([user.role, r.status, r.body.month]).toEqual([user.role, 200, '2026-09']);
                expect([user.role, recordArgs().where]).toEqual([user.role, { userId: user.id, date: SEPTEMBER }]);
            }
        }
    });

    it('見られるかどうかは、手当の公開の設定だけで決まる（評価ポイントの公開の設定には引きずられない・読まない）', async () => {
        loginAs(WORKER);

        mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue({ showToMembers: true, memberNotice: null });
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: false, memberNotice: null });
        expect((await getMe()).status).toBe(403);

        mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue({ showToMembers: false, memberNotice: null });
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: true, memberNotice: null });
        expect((await getMe()).status).toBe(200);

        expect(prisma.evaluationPointSetting.findUnique).not.toHaveBeenCalled();
    });

    it('権限の確かめが先: 見られない人には、month が無くても・形が違っていても 403（400 ではない）', async () => {
        setting({ showToMembers: false, memberNotice: null });
        loginAs(WORKER);
        for (const query of ['', 'month=2026-13', 'month=']) {
            const r = await getMe(query);
            expect([query, r.status, r.body]).toEqual([query, 403, { error: '権限がありません' }]);
        }
        expect(readsBeyondSetting()).toEqual([]);
    });
});

// ================================================================ ID の無いセッション

describe('ID の入っていないセッション', () => {
    it('セッションに ID が無い（無い・null・空文字）ときは 403。どのロールでも（admin でも・公開の設定がオンの作業員でも）。記録は読まない', async () => {
        setting({ showToMembers: true, memberNotice: NOTICE });
        const roles = ['admin', 'manager', 'foreman1', 'foreman2', 'worker'];
        const noIds: LoginUser[] = [{}, { id: null }, { id: '' }];
        for (const role of roles) {
            for (const noId of noIds) {
                // ログイン名・名前は入っている（ID の代わりに、ログイン名や名前で読んでしまわないこと）
                loginAs({ ...noId, role, name: 'だれか' }, 'login-someone');
                const r = await getMe();
                expect([role, JSON.stringify(noId), r.status, r.body]).toEqual([role, JSON.stringify(noId), 403, { error: '権限がありません' }]);
            }
        }
        // 空の ID では、本人の分に絞れない。読まずに断る（500 にもしない）
        expect(readsBeyondSetting()).toEqual([]);
        expect(serverErrorResponse).not.toHaveBeenCalled();
    });

    it('セッションの ID が文字列でない（オブジェクト・配列・数）ときも、記録を読まない・手当を返さない（where の userId が外れて、全員の分を読んでしまわない）', async () => {
        // 本物のセッションでは起きない形。起きたとしても、空のオブジェクトを where に渡すと「人で絞らない」になってしまうので、読む前に止める
        const brokenIds: unknown[] = [{}, { not: '' }, ['foremanA'], 123, true];
        for (const role of ['admin', 'worker']) {
            for (const brokenId of brokenIds) {
                loginAs({ id: brokenId as string, role, name: 'だれか' }, 'login-someone');
                const r = await getMe();
                // 今の作りでは 500（lib/allowancesReport.ts の loadMyAllowance が、読む前に例外にする）
                expect([role, JSON.stringify(brokenId), r.status, r.body.records]).toEqual([role, JSON.stringify(brokenId), 500, undefined]);
            }
        }
        expect(readsBeyondSetting()).toEqual([]);
    });
});

// ================================================================ 月の指定

describe('月の指定（month は必須）', () => {
    it('month が無い → 400「入力が不正です」。記録は読まない', async () => {
        for (const query of ['', 'date=2026-09-10', 'startDate=2026-09-01&endDate=2026-09-30', 'Month=2026-09']) {
            const r = await getMe(query);
            expect([query, r.status, r.body.error, r.body.details]).toEqual([query, 400, 'Validation Error', '入力が不正です']);
        }
        expect(readsBeyondSetting()).toEqual([]);
    });

    it("month の形が違う（'2026-13'・'2026-9'・'202609'・日付 など）→ 400「月が不正です」。記録は読まない", async () => {
        for (const month of ['2026-13', '2026-00', '2026-9', '202609', '2026/09', '2026-09-01', '2026-09-', ' 2026-09', '2026-09 ', '２０２６-０９', '９月', 'abc', '']) {
            const r = await getMonth(month);
            expect([month, r.status, r.body.error, r.body.details]).toEqual([month, 400, 'Validation Error', '月が不正です']);
        }
        expect(readsBeyondSetting()).toEqual([]);
    });

    it("年が 2000〜2999 でない月（'0026-09'・'1999-12'・'3000-01'）→ 400「月が不正です」。記録は読まない（別の月を読んでしまわない）", async () => {
        // '0026-09' は、Date が 1926年9月と読む。受け付けると、頼んだ月とは別の月（1926-09）の記録を返してしまう
        for (const month of ['0026-09', '0000-01', '1999-12', '3000-01', '9999-12']) {
            const r = await getMonth(month);
            expect([month, r.status, messageOf(r)]).toEqual([month, 400, '月が不正です']);
        }
        expect(readsBeyondSetting()).toEqual([]);
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
            expect(recordArgs().where).toEqual({ userId: 'foremanA', date: { gte: utc0(start), lt: utc0(next) } });
            expect(prisma.allowanceMonthClose.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { month } }));
        }
    });
});

// ================================================================ 本人の記録だけ

describe('返すのは、本人の記録だけ', () => {
    it('記録を読む where は { userId: セッションの ID, date: 月の範囲 }。日付の古い順 → 付けた順で、1回だけ読む', async () => {
        loginAs(FOREMAN_A);
        expect((await getMe()).status).toBe(200);

        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(recordArgs().where).toEqual({ userId: 'foremanA', date: SEPTEMBER });
        expect(recordArgs().orderBy).toEqual([{ date: 'asc' }, { createdAt: 'asc' }]);
    });

    it('クエリに「ほかの人の ID」を付けても、where の userId はセッションの ID のまま', async () => {
        loginAs(WORKER);
        const queries = [
            'month=2026-09&userId=foremanA',
            'userId=foremanA&month=2026-09',
            'month=2026-09&userId=foremanA&userId=admin1',
            'month=2026-09&user=foremanA&id=foremanA&targetUserId=foremanA&user_id=foremanA',
            'month=2026-09&userId=',
        ];
        for (const query of queries) {
            mock(prisma.allowanceRecord.findMany).mockClear();
            const r = await getMe(query);
            expect([query, r.status]).toEqual([query, 200]);
            expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
            expect([query, recordArgs().where]).toEqual([query, { userId: 'worker1', date: SEPTEMBER }]);
        }
    });

    it('管理者・マネージャーでも、クエリでほかの人の分は読めない（この API は、いつも自分の分）', async () => {
        for (const user of [ADMIN, MANAGER]) {
            mock(prisma.allowanceRecord.findMany).mockClear();
            loginAs(user);
            expect((await getMe('month=2026-09&userId=worker1')).status).toBe(200);
            expect([user.role, recordArgs().where]).toEqual([user.role, { userId: user.id, date: SEPTEMBER }]);
        }
    });

    it('読むのは ID（ログイン名・名前ではない）。ログインしている人が変われば、where の userId も変わる', async () => {
        const seen: unknown[] = [];
        for (const user of [WORKER, FOREMAN_A, FOREMAN_B, ADMIN, MANAGER]) {
            mock(prisma.allowanceRecord.findMany).mockClear();
            loginAs(user); // ログイン名は 'login-<id>'・名前は '作業員1' など（どちらも ID とは違う）
            await getMe();
            seen.push(recordArgs().where?.userId);
        }
        expect(seen).toEqual(['worker1', 'foremanA', 'foremanB', 'admin1', 'manager1']);
    });

    it('付けた人の名前・メモは、DB からも読まない（行と明細に要る列だけを読む）', async () => {
        await getMe();
        const select = recordArgs().select ?? {};
        expect(select).toMatchObject({ id: true, date: true, itemId: true, itemName: true, payRole: true, amount: true, status: true });
        for (const column of ['createdBy', 'createdByName', 'confirmedBy', 'confirmedByName', 'note', 'source', 'foremanId']) {
            expect([column, select[column]]).toEqual([column, undefined]);
        }
    });
});

// ================================================================ 応答の形

describe('応答の形', () => {
    it('月・注意書き・締め・「日数 × 金額 ＝ 合計」の行・合計・確認待ち・明細（Cache-Control: no-store）', async () => {
        const r = await getMe();
        expect(r.status).toBe(200);
        expect(r.cache).toBe('no-store');
        expect(r.body).toEqual({
            month: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30',
            notice: NOTICE,
            closed: false,
            lines: [
                // 職長 2日 × 1,500円 ＝ 3,000円（確認待ちの1件は入らない）
                { itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500, days: 2, total: 3000 },
                // 職長以外 2日 × 200円 ＝ 400円
                { itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, days: 2, total: 400 },
            ],
            totalDays: 4, totalAmount: 3400,
            pendingCount: 1, pendingAmount: 1500,
            records: [
                { id: 'm5', date: '2026-09-30', itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'confirmed' },
                { id: 'm4', date: '2026-09-20', itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'pending' },
                { id: 'm3', date: '2026-09-10', itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed' },
                { id: 'm2', date: '2026-09-02', itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'confirmed' },
                { id: 'm1', date: '2026-09-01', itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed' },
            ],
        });
        expect(serverErrorResponse).not.toHaveBeenCalled();
    });

    it('lines: 「職長 2日 × 1,500円 ＝ 3,000円」のように、職長／職長以外・1日の金額ごとにまとめる（職長が先。行を足すと合計になる）', async () => {
        const { body } = await getMe();
        expect(body.lines?.map((l) => [l.payRole, l.amount, l.days, l.total])).toEqual([
            ['foreman', 1500, 2, 3000],
            ['member', 200, 2, 400],
        ]);
        const lines = body.lines ?? [];
        expect([lines.reduce((sum, l) => sum + l.days, 0), lines.reduce((sum, l) => sum + l.total, 0)]).toEqual([body.totalDays, body.totalAmount]);
    });

    it('確認待ちは、合計にも行にも入らない（件数と金額は、別に出す）。明細には出る', async () => {
        const { body } = await getMe();
        // 確定は 1,500 × 2 ＋ 200 × 2 ＝ 3,400円・4日。確認待ちの 1,500円・1件は入っていない
        expect([body.totalDays, body.totalAmount, body.pendingCount, body.pendingAmount]).toEqual([4, 3400, 1, 1500]);
        expect(body.records?.filter((rec) => rec.status === 'pending').map((rec) => rec.id)).toEqual(['m4']);

        // 確認待ちだけの月: 合計は 0・行は無い
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            myRow('p1', '2026-09-05', 'foreman', 1500, 'pending'),
            myRow('p2', '2026-09-06', 'foreman', 1500, 'pending'),
        ]);
        const pendingOnly = (await getMe()).body;
        expect([pendingOnly.totalDays, pendingOnly.totalAmount, pendingOnly.pendingCount, pendingOnly.pendingAmount]).toEqual([0, 0, 2, 3000]);
        expect(pendingOnly.lines).toEqual([]);
        expect(pendingOnly.records?.map((rec) => [rec.id, rec.status])).toEqual([['p2', 'pending'], ['p1', 'pending']]);
    });

    it('records は日付の新しい順。入っている項目は id・date・itemName・payRole・amount・status だけ（付けた人の名前・メモは入っていない）', async () => {
        const { body } = await getMe();
        expect(body.records?.map((rec) => [rec.id, rec.date])).toEqual([
            ['m5', '2026-09-30'], ['m4', '2026-09-20'], ['m3', '2026-09-10'], ['m2', '2026-09-02'], ['m1', '2026-09-01'],
        ]);
        for (const rec of body.records ?? []) {
            expect(Object.keys(rec).sort()).toEqual(['amount', 'date', 'id', 'itemName', 'payRole', 'status']);
        }
        // DB の行に入っていた「付けた人・認めた人・メモ・入力元」は、応答のどこにも出ない
        expect(JSON.stringify(body)).not.toMatch(/管理者1|admin1|マネージャー1|ひみつ|attendance|rate1/);
    });

    it('月の途中で金額が変わった月は、金額ごとに行が分かれる（金額は、記録に写してある金額のまま）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            myRow('a1', '2026-09-01', 'member', 200),
            myRow('a2', '2026-09-02', 'member', 200),
            myRow('a3', '2026-09-16', 'member', 300),
        ]);
        const { body } = await getMe();
        expect(body.lines?.map((l) => [l.payRole, l.amount, l.days, l.total])).toEqual([['member', 300, 1, 300], ['member', 200, 2, 400]]);
        expect([body.totalDays, body.totalAmount]).toEqual([3, 700]);
        // 金額の表（AllowanceRate）は読まない（afterEach で、ほかの表を読んでいないことを確かめている）
    });

    it('closed: その月の締めの行があれば true、無ければ false（数字と明細は同じ）', async () => {
        const open = (await getMe()).body;
        expect(open.closed).toBe(false);

        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue({ month: '2026-09' });
        const closed = (await getMe()).body;
        expect(closed.closed).toBe(true);
        expect({ ...closed, closed: false }).toEqual(open);
        // 読むのは「頼んだ月」の締めの行
        expect(prisma.allowanceMonthClose.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { month: '2026-09' } }));
    });

    it('notice: 公開の設定の注意書き。注意書きが無ければ null', async () => {
        loginAs(WORKER);
        setting({ showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります' });
        expect((await getMe()).body.notice).toBe('金額は、月を締めるまで変わることがあります');

        setting({ showToMembers: true, memberNotice: null });
        expect((await getMe()).body.notice).toBeNull();
        // 評価ポイントの注意書きは使わない
        expect(prisma.evaluationPointSetting.findUnique).not.toHaveBeenCalled();
    });

    it('notice: 管理者・マネージャーには、公開の設定がオフでも注意書きを返す。設定の行が無ければ null', async () => {
        loginAs(ADMIN);
        setting({ showToMembers: false, memberNotice: 'まだ準備中です' });
        expect((await getMe()).body.notice).toBe('まだ準備中です');

        setting(null);
        const r = await getMe();
        expect([r.status, r.body.notice]).toEqual([200, null]);
    });

    it('記録が無い月は、行も明細も空・数字は全部 0（null にはしない）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);
        const r = await getMe();
        expect(r.status).toBe(200);
        expect(r.body).toEqual({
            month: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', notice: NOTICE, closed: false,
            lines: [], totalDays: 0, totalAmount: 0, pendingCount: 0, pendingAmount: 0, records: [],
        });
    });
});

// ================================================================ 読むもの・例外・設定

describe('読むもの・例外・設定', () => {
    it('職長・作業員のとき: 公開の設定 → 本人の記録・その月の締め を読むだけ（何も書かない）', async () => {
        loginAs(WORKER);
        expect((await getMe()).status).toBe(200);
        expect(Array.from(new Set(dbCalls())).sort()).toEqual([CLOSE_READ, RECORD_READ, SETTING_READ].sort());
        // 見られるかどうかを決める「公開の設定」が、いちばん先
        expect(dbCalls()[0]).toBe(SETTING_READ);
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceMonthClose.findUnique).toHaveBeenCalledTimes(1);
        // 公開の設定は、id が 'default' の1行
        for (const call of mock(prisma.allowanceSetting.findUnique).mock.calls) {
            expect(call[0]).toEqual(expect.objectContaining({ where: { id: 'default' } }));
        }
    });

    it('記録を読むときに例外が起きたら 500（何の操作で起きたかと、起きた例外を serverErrorResponse に渡す）', async () => {
        const boom = new Error('DB に届かない');
        mock(prisma.allowanceRecord.findMany).mockRejectedValue(boom);
        const r = await getMe();
        expect(r.status).toBe(500);
        expect(r.body.records).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledTimes(1);
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の取得', boom);
    });

    it('公開の設定・締めを読むときに例外が起きても 500（記録を返してしまわない）', async () => {
        const boom = new Error('DB に届かない');
        loginAs(WORKER);
        mock(prisma.allowanceSetting.findUnique).mockRejectedValue(boom);
        const bySetting = await getMe();
        expect([bySetting.status, bySetting.body.records]).toEqual([500, undefined]);
        // 見られるかどうかが分からないまま、記録を読みに行かない
        expect(readsBeyondSetting()).toEqual([]);

        setting({ showToMembers: true, memberNotice: NOTICE });
        mock(prisma.allowanceMonthClose.findUnique).mockRejectedValue(boom);
        const byClose = await getMe();
        expect([byClose.status, byClose.body.records]).toEqual([500, undefined]);
        expect(serverErrorResponse).toHaveBeenCalledTimes(2);
    });

    it("毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'）", () => {
        expect(dynamic).toBe('force-dynamic');
    });
});
