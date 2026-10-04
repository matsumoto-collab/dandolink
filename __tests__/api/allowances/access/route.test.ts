/**
 * @jest-environment node
 *
 * GET /api/allowances/access（「手当」の画面の見せ方）のテスト。
 *
 *   ログインしている人ならだれでも呼べる。答えは { mode: 'manager' | 'member' | 'none' }
 *     'manager' … 全員の一覧（admin・manager）
 *     'member'  … 自分の手当だけ（worker・foreman1・foreman2 で、手当の公開の設定がオンのとき）
 *     'none'    … 見せない（それ以外）
 *
 * route は lib/allowancesServer.ts の resolveAllowanceAccessMode() を本物のまま呼ぶ。
 * 差し替えているのは、jest.setup.ts の @/lib/prisma と @/lib/api/utils だけ
 * （prisma のモックは where を見ずに、テストが決めた答えを返すだけ）。
 * だから「どの設定を読んだか」は、返ってきた値ではなく、DB の関数に渡した引数と、呼ばれた関数の一覧（dbCalls）で確かめる。
 *
 * いちばん守りたい約束:
 *   - 見せ方は、ロールと「手当の公開の設定」（AllowanceSetting）だけで決まる。評価ポイントの公開の設定は読まない
 *   - 公開の設定の行が無いときは、「見せない」側に倒す
 *   - 読むのは、手当の公開の設定の1行だけ。何も書かない
 *
 * この API は時計を見ない（日付も使わない）。
 */
import { NextResponse } from 'next/server';
import { GET, dynamic } from '@/app/api/allowances/access/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;

// ---------------------------------------------------------------- ログインしている人

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role?: string | null; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });

// ---------------------------------------------------------------- 公開の設定

type SettingRow = { showToMembers: boolean; memberNotice: string | null } | null;
const ON: SettingRow = { showToMembers: true, memberNotice: null };
const OFF: SettingRow = { showToMembers: false, memberNotice: null };
/** 公開の設定の行が無い */
const NO_ROW: SettingRow = null;

/**
 * 手当の公開の設定（AllowanceSetting の1行）を決める。
 * 評価ポイントの公開の設定は、いつも「その逆」にしておく
 * （手当の見せ方が、評価ポイントの設定に引きずられたら、答えが変わって気づけるように）。
 */
const setting = (row: SettingRow) => {
    mock(prisma.allowanceSetting.findUnique).mockResolvedValue(row);
    mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue({ showToMembers: !(row?.showToMembers ?? false), memberNotice: null });
};

// ---------------------------------------------------------------- 呼び方と、確かめるための部品

interface AccessBody { mode?: string; error?: string }
const getAccess = async () => {
    const res = await GET();
    return { status: res.status, body: (await res.json()) as AccessBody, cache: res.headers.get('Cache-Control') };
};

const prismaMock = prisma as unknown as Record<string, unknown>;
/** モックの prisma の中身のうち、表（モデル）にあたるもの: { findMany: jest.fn(), ... } の形のオブジェクト */
const isModel = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * これまでに呼ばれた DB の操作を、呼ばれた順に並べた名前の一覧（全部の表・$transaction・$executeRaw も入る）。
 *   例: ['allowanceSetting.findUnique']
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

/** 公開の設定を読んでいれば、その1回だけ。それ以外の DB の操作は、どのテストでも無いこと */
const SETTING_READ = 'allowanceSetting.findUnique';

beforeEach(() => {
    jest.clearAllMocks();
    // requireAuth の既定のモックには name・username が無いので、テストごとに入れる
    loginAs({ id: 'worker1', role: 'worker', name: '作業員1' });
    setting(OFF);
});

afterEach(() => {
    // この API が DB にするのは「手当の公開の設定を読む」だけ。
    // ほかの表（評価ポイントの表も）は読まない・何も書かない・トランザクションも開かない
    expect(dbCalls().filter((name) => name !== SETTING_READ)).toEqual([]);
});

// ================================================================ ログイン

describe('ログインしていない人', () => {
    it('ログインしていなければ、requireAuth の答え（401）をそのまま返す。公開の設定は読まない', async () => {
        const unauthorized = NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        mock(requireAuth).mockResolvedValue({ session: null, error: unauthorized });
        setting(ON);

        const res = await GET();
        // requireAuth が作った応答そのもの（作り直さない）
        expect(res).toBe(unauthorized);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: '認証が必要です' });
        expect(dbCalls()).toEqual([]);
    });
});

// ================================================================ admin・manager

describe('admin・manager: 全員の一覧（manager）', () => {
    it("admin・manager は { mode: 'manager' }。公開の設定がオンでも・オフでも・行が無くても同じで、設定を読まない", async () => {
        for (const row of [ON, OFF, NO_ROW]) {
            setting(row);
            for (const role of ['admin', 'manager']) {
                loginAs({ id: 'u1', role, name: 'だれか' });
                const r = await getAccess();
                expect([row, role, r.status, r.body]).toEqual([row, role, 200, { mode: 'manager' }]);
            }
        }
        expect(dbCalls()).toEqual([]);
    });
});

// ================================================================ worker・foreman1・foreman2

describe('worker・foreman1・foreman2: 手当の公開の設定で決まる', () => {
    const MEMBER_ROLES = ['worker', 'foreman1', 'foreman2'];

    it("公開の設定がオンなら { mode: 'member' }（自分の手当だけ）", async () => {
        setting(ON);
        for (const role of MEMBER_ROLES) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await getAccess();
            expect([role, r.status, r.body]).toEqual([role, 200, { mode: 'member' }]);
        }
    });

    it("公開の設定がオフなら { mode: 'none' }（見せない）", async () => {
        setting(OFF);
        for (const role of MEMBER_ROLES) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await getAccess();
            expect([role, r.status, r.body]).toEqual([role, 200, { mode: 'none' }]);
        }
    });

    it("公開の設定の行が無ければ { mode: 'none' }（行が無くても、見える側には倒さない）", async () => {
        setting(NO_ROW);
        for (const role of MEMBER_ROLES) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await getAccess();
            expect([role, r.status, r.body]).toEqual([role, 200, { mode: 'none' }]);
        }
    });

    it('注意書きがあっても無くても、見せ方は showToMembers だけで決まる', async () => {
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: false, memberNotice: '準備中です' });
        expect((await getAccess()).body).toEqual({ mode: 'none' });
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります' });
        expect((await getAccess()).body).toEqual({ mode: 'member' });
    });

    it("読むのは、手当の公開の設定の1行（id が 'default'）だけ。1回の呼び出しで1回だけ読む", async () => {
        setting(ON);
        loginAs({ id: 'foremanA', role: 'foreman2', name: '職長A' });
        expect((await getAccess()).body).toEqual({ mode: 'member' });

        expect(dbCalls()).toEqual([SETTING_READ]);
        expect(prisma.allowanceSetting.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'default' } }));
    });
});

// ================================================================ それ以外のロール

describe('それ以外のロール: 見せない（none）', () => {
    it("partner・partner_member・accountant・support は、公開の設定がオンでも { mode: 'none' }。設定を読まない", async () => {
        setting(ON);
        for (const role of ['partner', 'partner_member', 'accountant', 'support']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await getAccess();
            expect([role, r.status, r.body]).toEqual([role, 200, { mode: 'none' }]);
        }
        expect(dbCalls()).toEqual([]);
    });

    it("ロールの入っていないセッション（無い・null・空文字）・知らないロールも { mode: 'none' }。設定を読まない", async () => {
        setting(ON);
        const users: { id: string; role?: string | null; name?: string }[] = [
            { id: 'nobody', name: 'ロールなし' },
            { id: 'nobody', role: null, name: 'ロールなし' },
            { id: 'nobody', role: '', name: 'ロールなし' },
            { id: 'nobody', role: 'unknown', name: '知らないロール' },
            { id: 'nobody', role: 'foreman', name: '知らないロール' },   // 'foreman1'・'foreman2' ではない
            { id: 'nobody', role: 'foreman3', name: '知らないロール' },
        ];
        for (const user of users) {
            loginAs(user);
            const r = await getAccess();
            expect([user.role, r.status, r.body]).toEqual([user.role, 200, { mode: 'none' }]);
        }
        expect(dbCalls()).toEqual([]);
    });
});

// ================================================================ 見せ方を決めるもの

describe('見せ方は、ロールと「手当の公開の設定」だけで決まる', () => {
    it('評価ポイントの公開の設定には引きずられない（評価ポイントがオン・手当がオフ → none ／ 評価ポイントがオフ・手当がオン → member）。評価ポイントの設定は読まない', async () => {
        loginAs({ id: 'worker1', role: 'worker', name: '作業員1' });

        mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue({ showToMembers: true, memberNotice: null });
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: false, memberNotice: null });
        expect((await getAccess()).body).toEqual({ mode: 'none' });

        mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue({ showToMembers: false, memberNotice: null });
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: true, memberNotice: null });
        expect((await getAccess()).body).toEqual({ mode: 'member' });

        expect(prisma.evaluationPointSetting.findUnique).not.toHaveBeenCalled();
        expect(dbCalls()).toEqual([SETTING_READ, SETTING_READ]);
    });

    it('見るのは、セッションのロールだけ（ID・名前が admin でも、ロールが worker なら worker の見せ方）', async () => {
        setting(OFF);
        // loginAs は username を 'login-admin' にする。ID・名前・ログイン名のどれをロールの代わりに使っても、答えが変わる
        loginAs({ id: 'admin', role: 'worker', name: 'admin' });
        expect((await getAccess()).body).toEqual({ mode: 'none' });

        setting(ON);
        loginAs({ id: 'worker', role: 'admin', name: 'worker' });
        expect((await getAccess()).body).toEqual({ mode: 'manager' });
    });

    it('ロールに大文字が混ざっていても、同じ見せ方（小文字にそろえて比べる）', async () => {
        setting(ON);
        const cases: [string, string][] = [
            ['ADMIN', 'manager'], ['Manager', 'manager'],
            ['WORKER', 'member'], ['Foreman1', 'member'], ['FOREMAN2', 'member'],
            ['PARTNER', 'none'], ['Partner_Member', 'none'],
        ];
        for (const [role, mode] of cases) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            expect([role, (await getAccess()).body]).toEqual([role, { mode }]);
        }
        setting(OFF);
        for (const role of ['WORKER', 'Foreman1', 'FOREMAN2']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            expect([role, (await getAccess()).body]).toEqual([role, { mode: 'none' }]);
        }
    });
});

// ================================================================ 応答・例外・設定

describe('応答・例外・設定', () => {
    it('応答は { mode } だけ（ほかの項目を足さない）。どの見せ方でも 200・Cache-Control: no-store', async () => {
        const cases: [string, SettingRow, string][] = [
            ['admin', OFF, 'manager'],
            ['worker', ON, 'member'],
            ['worker', OFF, 'none'],
            ['partner', ON, 'none'],
        ];
        for (const [role, row, mode] of cases) {
            setting(row);
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await getAccess();
            expect([role, r.status, r.body, r.cache]).toEqual([role, 200, { mode }, 'no-store']);
        }
        expect(serverErrorResponse).not.toHaveBeenCalled();
    });

    it('公開の設定を読むときに例外が起きたら 500（何の操作で起きたかと、起きた例外を serverErrorResponse に渡す）', async () => {
        const boom = new Error('DB に届かない');
        mock(prisma.allowanceSetting.findUnique).mockRejectedValue(boom);
        loginAs({ id: 'worker1', role: 'worker', name: '作業員1' });

        const r = await getAccess();
        expect(r.status).toBe(500);
        // 見せ方を返してしまわない
        expect(r.body.mode).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledTimes(1);
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の表示の設定の取得', boom);
    });

    it('ログインの確かめ（requireAuth）で例外が起きても 500（例外のまま外へ出さない）。公開の設定は読まない', async () => {
        const boom = new Error('セッションが読めない');
        mock(requireAuth).mockRejectedValue(boom);

        const r = await getAccess();
        expect(r.status).toBe(500);
        expect(r.body.mode).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の表示の設定の取得', boom);
        expect(dbCalls()).toEqual([]);
    });

    it("毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'）", () => {
        expect(dynamic).toBe('force-dynamic');
    });
});
