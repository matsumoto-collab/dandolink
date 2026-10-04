/**
 * @jest-environment node
 *
 * GET・PUT /api/allowances/settings（手当の公開の設定）のテスト。
 *
 *   GET  管理者（admin）だけ。{ showToMembers, memberNotice }
 *   PUT  管理者（admin）だけ。body: { showToMembers: boolean, memberNotice?: string | null }
 *        注意書きは前後の空白を取って 200字まで・空と null は「注意書きなし」。
 *        memberNotice を省いたときは、今の注意書きをそのまま残す（オン／オフだけを送っても、注意書きは消えない）。
 *        行が無ければ作る（upsert）。中身が変わったときだけ書き、同じトランザクションで履歴（AllowanceLog の setting_updated）を残す。
 *        トランザクションの最初に、手当の書き込みの鍵を取る（鍵 → 今の行を読む → 変わっていれば書く → 履歴）。
 *
 * route は lib/allowances.ts・lib/allowancesServer.ts の関数を本物のまま呼ぶ。
 * 差し替えているのは、jest.setup.ts の @/lib/prisma と @/lib/api/utils だけ
 * （prisma のモックは where を見ずに、テストが決めた答えを返すだけ）。
 * だから「何を読んだか・何を書いたか」は、返ってきた値ではなく、DB の関数に渡した引数と、呼ばれた関数の一覧（dbCalls）で確かめる。
 *
 * トランザクションの中かどうかの見分け方（__tests__/lib/allowancesServer.test.ts と同じやり方）:
 *   jest.setup.ts の $transaction は、同じ prisma をそのまま callback に渡す。それだと
 *   「鍵を取る・今の行を読む・設定を書く・履歴を書く」が、トランザクションの中（tx）なのか、外（prisma）なのかが見分けられない。
 *   このファイルでは、tx として「prisma と同じモック関数を持つ、別のオブジェクト」を渡す。
 *   dbCalls() の名前が「tx.」で始まるのがトランザクションの中、「prisma.」で始まるのが外。
 *
 * いちばん守りたい約束:
 *   - 読むのも変えるのも管理者だけ（マネージャーも不可）
 *   - 書く前に鍵を取り、そのあとで今の行を読む（2人が同時に保存しても、古い行と見比べない）
 *   - 中身が同じなら、書かない・履歴も書かない。変わったら、設定と履歴を同じトランザクションで書く
 *   - 注意書きを省いて送っても、今の注意書きは消えない（消すのは、null・空を送ったときだけ）
 *   - 評価ポイントの表（公開の設定・履歴）には触らない
 *
 * この API は時計を見ない（日付も使わない）。
 */
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { GET, PUT, dynamic } from '@/app/api/allowances/settings/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;

// ---------------------------------------------------------------- ログインしている人

interface LoginUser { id: string; role?: string | null; name?: string }
/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: LoginUser) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN: LoginUser = { id: 'admin1', role: 'admin', name: '管理者1' };

/** 管理者ではない人（マネージャーも入る。ロールの入っていないセッションも） */
const NOT_ADMINS: LoginUser[] = [
    { id: 'manager1', role: 'manager', name: 'マネージャー1' },
    { id: 'foremanA', role: 'foreman1', name: '職長A' },
    { id: 'foremanB', role: 'foreman2', name: '職長B' },
    { id: 'worker1', role: 'worker', name: '作業員1' },
    { id: 'partner1', role: 'partner', name: '協力会社' },
    { id: 'pm1', role: 'partner_member', name: '協力会社のメンバー' },
    { id: 'accountant1', role: 'accountant', name: '税理士' },
    { id: 'support1', role: 'support', name: '応援' },
    { id: 'nobody1', role: '', name: 'ロールが空' },
    { id: 'nobody2', role: null, name: 'ロールが null' },
    { id: 'nobody3', name: 'ロールが無い' },
];

/** ログインしていないときに requireAuth が返す形（応答は、呼ばれるたびに作る。同じ応答の body は1回しか読めない） */
const notLoggedIn = () =>
    mock(requireAuth).mockImplementation(async () => ({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }));

// ---------------------------------------------------------------- 呼び方と、応答の読み方

interface Body { error?: string; details?: string; showToMembers?: boolean; memberNotice?: string | null }
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Body, cache: res.headers.get('Cache-Control') });

const getSetting = () => GET().then(read);
/** 文字列を、そのまま body にして送る（JSON として読めない body を送るため） */
const putRaw = (rawBody: string) =>
    PUT(new NextRequest('http://localhost/api/allowances/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
    })).then(read);
/** 値が undefined の項目は、JSON にすると消える（＝その項目を送らない） */
const put = (body: unknown) => putRaw(JSON.stringify(body));

// ---------------------------------------------------------------- DB の中身（モックが返すもの）

type SettingRow = { showToMembers: boolean; memberNotice: string | null } | null;
/** 今の公開の設定（AllowanceSetting の、id が 'default' の1行）を決める。null = 行が無い */
const settingRow = (row: SettingRow) => mock(prisma.allowanceSetting.findUnique).mockResolvedValue(row);

// ---------------------------------------------------------------- トランザクションの中かどうかを見分ける部品

const prismaMock = prisma as unknown as Record<string, unknown>;
/** モックの prisma の中身のうち、表（モデル）にあたるもの: { findMany: jest.fn(), ... } の形のオブジェクト */
const isModel = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * トランザクションの中で使う tx。prisma とは別のオブジェクトだが、中のモック関数は prisma と同じもの
 * （だから、DB の答えは prisma.xxx.yyy に決めればよい）。
 */
const txMock: Record<string, unknown> = Object.fromEntries(
    Object.entries(prismaMock).map(([name, value]) => [name, isModel(value) ? { ...value } : value]),
);
const tx = txMock as unknown as Prisma.TransactionClient;

/** 呼ばれたときの this → 'prisma.allowanceSetting'・'tx.allowanceLog' などの名前 */
const ownerNames = new Map<unknown, string>([[prismaMock, 'prisma'], [txMock, 'tx']]);
for (const [name, value] of Object.entries(prismaMock)) {
    if (!isModel(value)) continue;
    ownerNames.set(value, `prisma.${name}`);
    ownerNames.set(txMock[name], `tx.${name}`);
}

/**
 * これまでに呼ばれた DB の操作を、呼ばれた順に並べた名前の一覧（全部の表・$transaction・$executeRaw も入る）。
 *   例: ['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceSetting.findUnique', 'tx.allowanceSetting.upsert', 'tx.allowanceLog.create']
 * 「tx.」で始まるのがトランザクションの中、「prisma.」で始まるのがトランザクションの外。
 */
const dbCalls = (): string[] => {
    const seen: { order: number; name: string }[] = [];
    const collect = (fn: unknown, method: string) => {
        if (!jest.isMockFunction(fn)) return;
        fn.mock.invocationCallOrder.forEach((order, i) => {
            seen.push({ order, name: `${ownerNames.get(fn.mock.contexts[i]) ?? '（どこからか不明）'}.${method}` });
        });
    };
    for (const [name, value] of Object.entries(prismaMock)) {
        if (isModel(value)) for (const [method, fn] of Object.entries(value)) collect(fn, method);
        else collect(value, name);
    }
    return seen.sort((a, b) => a.order - b.order).map((c) => c.name);
};

/** GET が DB にすること: トランザクションの外で、公開の設定を1回読むだけ（鍵は取らない） */
const GET_CALLS = ['prisma.allowanceSetting.findUnique'];
/** PUT で、中身が変わったとき: トランザクションの中で「鍵を取る → 今の行を読む → 設定を書く → 履歴を書く」 */
const SAVE_CALLS = ['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceSetting.findUnique', 'tx.allowanceSetting.upsert', 'tx.allowanceLog.create'];
/** PUT で、中身が同じだったとき: トランザクションの中で「鍵を取る → 今の行を読む」だけ（書かない・履歴も書かない） */
const UNCHANGED_CALLS = ['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceSetting.findUnique'];

/** 手当の書き込みの鍵の SQL（トランザクションが終わると外れる鍵。記録を足す・月を締める などと同じ鍵） */
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('dandolink-allowance'))";
/** $executeRaw（タグ付きテンプレート）に渡した SQL を、1つの文字にしたもの（呼ばれた回数ぶん） */
const lockSqls = () => mock(prisma.$executeRaw).mock.calls.map((c) => Array.from(c[0] as readonly string[]).join('?'));
/** $transaction に渡した2つめの引数（トランザクションの設定。呼ばれた回数ぶん） */
const transactionOptions = () => mock(prisma.$transaction).mock.calls.map((c) => c[1] as unknown);
/** 始められるまで待つのは 5秒まで・始めてから終わるまでは 10秒まで（鍵が空くのを待つ時間は、この 10秒に入る） */
const TX_OPTIONS = { maxWait: 5000, timeout: 10000 };

/** 注意書きの形が違う・長すぎるときの文言 */
const NOTICE_MESSAGE = '注意書きは200字までの文字で入れてください';

interface UpsertArgs { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }
/** allowanceSetting.upsert に渡した引数（call 回目。既定は最初） */
const upsertArgs = (call = 0) => mock(prisma.allowanceSetting.upsert).mock.calls[call][0] as UpsertArgs;
interface LogArgs { data: { action: string; actorId: string; actorName: string; detail: { before: unknown; after: unknown } } }
/** allowanceLog.create に渡した引数（call 回目。既定は最初） */
const logArgs = (call = 0) => mock(prisma.allowanceLog.create).mock.calls[call][0] as LogArgs;

beforeEach(() => {
    jest.clearAllMocks();
    // このファイルでは、トランザクションの中に「prisma とは別の tx」を渡す（ファイルの先頭の説明を参照）
    mock(prisma.$transaction).mockImplementation(async (callback: (client: Prisma.TransactionClient) => unknown) => callback(tx));
    // requireAuth の既定のモックには name・username が無いので、テストごとに入れる
    loginAs(ADMIN);

    // 鍵（$executeRaw）は取れたことにする（前のテストが例外にしていても、ここで元に戻す）
    mock(prisma.$executeRaw).mockResolvedValue(0);
    settingRow({ showToMembers: false, memberNotice: null });            // 今は「見せない・注意書きなし」
    mock(prisma.allowanceSetting.upsert).mockResolvedValue({ id: 'default' });
    mock(prisma.allowanceLog.create).mockResolvedValue({ id: 'log1' });
});

afterEach(() => {
    // どのテストでも、触るのは「手当の公開の設定」と「手当の履歴」だけ（PUT は、その前に鍵を取る）。
    // 評価ポイントの表（公開の設定・履歴）や、ほかの表には触らない
    const allowed = new Set([...GET_CALLS, ...SAVE_CALLS]);
    expect(dbCalls().filter((name) => !allowed.has(name))).toEqual([]);
});

// ================================================================ GET

describe('GET: ログインと権限（管理者だけ）', () => {
    it('ログインしていなければ、requireAuth の答え（401）をそのまま返す。設定は読まない', async () => {
        notLoggedIn();
        const r = await getSetting();
        expect([r.status, r.body]).toEqual([401, { error: '認証が必要です' }]);
        expect(dbCalls()).toEqual([]);
    });

    it('管理者以外（マネージャーも）は 403「権限がありません」。設定は読まない', async () => {
        settingRow({ showToMembers: true, memberNotice: '見えてはいけない注意書き' });
        for (const user of NOT_ADMINS) {
            loginAs(user);
            const r = await getSetting();
            expect([user.name, r.status, r.body]).toEqual([user.name, 403, { error: '権限がありません' }]);
        }
        expect(dbCalls()).toEqual([]);
    });
});

describe('GET: 今の設定を返す', () => {
    it("管理者は、今の設定 { showToMembers, memberNotice } を読める（id が 'default' の1行。Cache-Control: no-store）", async () => {
        settingRow({ showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります' });
        const r = await getSetting();
        expect([r.status, r.body, r.cache]).toEqual([200, { showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります' }, 'no-store']);

        expect(dbCalls()).toEqual(GET_CALLS);
        expect(prisma.allowanceSetting.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'default' } }));
    });

    it('オフ・注意書きなしの設定も、そのまま返す', async () => {
        settingRow({ showToMembers: false, memberNotice: null });
        expect((await getSetting()).body).toEqual({ showToMembers: false, memberNotice: null });
        settingRow({ showToMembers: false, memberNotice: '準備中です' });
        expect((await getSetting()).body).toEqual({ showToMembers: false, memberNotice: '準備中です' });
    });

    it('行が無ければ「見せない・注意書きなし」{ showToMembers: false, memberNotice: null }（行は作らない）', async () => {
        settingRow(null);
        const r = await getSetting();
        expect([r.status, r.body]).toEqual([200, { showToMembers: false, memberNotice: null }]);
        // 読むだけ（GET では、無い行を作らない）
        expect(dbCalls()).toEqual(GET_CALLS);
    });

    it('返すのは showToMembers と memberNotice の2つだけ（行のほかの列＝直した人・日時は出さない）', async () => {
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({
            id: 'default', showToMembers: true, memberNotice: 'メモ', updatedBy: 'admin9',
            createdAt: new Date('2026-09-01T00:00:00.000Z'), updatedAt: new Date('2026-10-01T00:00:00.000Z'),
        });
        expect((await getSetting()).body).toEqual({ showToMembers: true, memberNotice: 'メモ' });
    });

    it('設定を読むときに例外が起きたら 500（何の操作で起きたかと、起きた例外を serverErrorResponse に渡す）', async () => {
        const boom = new Error('DB に届かない');
        mock(prisma.allowanceSetting.findUnique).mockRejectedValue(boom);
        const r = await getSetting();
        expect(r.status).toBe(500);
        expect(r.body.showToMembers).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledTimes(1);
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の公開の設定の取得', boom);
    });
});

// ================================================================ PUT: ログインと権限

describe('PUT: ログインと権限（管理者だけ）', () => {
    it('ログインしていなければ、requireAuth の答え（401）をそのまま返す。何も読まない・書かない', async () => {
        notLoggedIn();
        const r = await put({ showToMembers: true, memberNotice: null });
        expect([r.status, r.body]).toEqual([401, { error: '認証が必要です' }]);
        expect(dbCalls()).toEqual([]);
    });

    it('管理者以外（マネージャーも）は 403「権限がありません」。何も読まない・書かない（トランザクションも開かない）', async () => {
        for (const user of NOT_ADMINS) {
            loginAs(user);
            const r = await put({ showToMembers: true, memberNotice: null });
            expect([user.name, r.status, r.body]).toEqual([user.name, 403, { error: '権限がありません' }]);
        }
        expect(dbCalls()).toEqual([]);
    });

    it('入力の形が違っていても、先に権限で断る（管理者以外には 400 ではなく 403）', async () => {
        loginAs({ id: 'manager1', role: 'manager', name: 'マネージャー1' });
        for (const raw of ['これは JSON ではない', '[]', '{"showToMembers":"はい"}']) {
            const r = await putRaw(raw);
            expect([raw, r.status, r.body]).toEqual([raw, 403, { error: '権限がありません' }]);
        }
        expect(dbCalls()).toEqual([]);
    });
});

// ================================================================ PUT: 入力の形

describe('PUT: 入力の形（合わなければ 400。何も読まない・書かない・鍵も取らない）', () => {
    /** 形のまちがいは validationErrorResponse。モックでは、文言が error ではなく details に入る */
    const expectInvalid = (label: string, r: { status: number; body: Body }, message = '入力が不正です') =>
        expect([label, r.status, r.body.error, r.body.details]).toEqual([label, 400, 'Validation Error', message]);

    it('JSON として読めない body・オブジェクトでない body（配列・null・文字列・数・真偽値）→ 400「入力が不正です」（500 にしない）', async () => {
        for (const raw of ['これは JSON ではない', '', '{"showToMembers":true', 'null', '[]', '[true]', '[{"showToMembers":true,"memberNotice":null}]', '"文字列"', '5', 'true']) {
            expectInvalid(raw, await putRaw(raw));
        }
        expect(dbCalls()).toEqual([]);
        expect(serverErrorResponse).not.toHaveBeenCalled();
    });

    it("showToMembers が boolean でない（無い・null・文字列の 'true'・数の 1 と 0・配列・オブジェクト）→ 400「入力が不正です」", async () => {
        const cases: [string, Record<string, unknown>][] = [
            ['無い', { memberNotice: null }],
            ['無い（注意書きだけを送る）', { memberNotice: '注意書きだけ' }],
            ['空のオブジェクト', {}],
            ['null', { showToMembers: null, memberNotice: null }],
            ["文字列の 'true'", { showToMembers: 'true', memberNotice: null }],
            ["文字列の 'false'", { showToMembers: 'false', memberNotice: null }],
            ['数の 1', { showToMembers: 1, memberNotice: null }],
            ['数の 0', { showToMembers: 0, memberNotice: null }],
            ['配列', { showToMembers: [true], memberNotice: null }],
            ['オブジェクト', { showToMembers: { value: true }, memberNotice: null }],
        ];
        for (const [label, body] of cases) expectInvalid(label, await put(body));
        expect(dbCalls()).toEqual([]);
    });

    it('memberNotice が文字列でも null でもない（数・真偽値・配列・オブジェクト）→ 400「注意書きは200字までの文字で入れてください」', async () => {
        const cases: [string, unknown][] = [
            ['数', 123], ['数の 0', 0], ['true', true], ['false', false], ['空の配列', []], ['文字列の配列', ['メモ']], ['オブジェクト', { text: 'メモ' }],
        ];
        // 今の行に注意書きがあっても、形の違う注意書きを「省いた」ことにして通さない
        settingRow({ showToMembers: false, memberNotice: '今の注意書き' });
        for (const [label, memberNotice] of cases) expectInvalid(label, await put({ showToMembers: true, memberNotice }), NOTICE_MESSAGE);
        expect(dbCalls()).toEqual([]);
    });

    it('memberNotice が 201字 → 400「注意書きは200字までの文字で入れてください」。200字ちょうどは保存できる（字数は、前後の空白を取ってから数える）', async () => {
        const just = 'あ'.repeat(200);
        const over = 'あ'.repeat(201);

        expectInvalid('201字', await put({ showToMembers: true, memberNotice: over }), NOTICE_MESSAGE);
        expectInvalid('前後に空白の付いた 201字', await put({ showToMembers: true, memberNotice: `  ${over}  ` }), NOTICE_MESSAGE);
        expect(dbCalls()).toEqual([]);

        // 200字ちょうど
        const ok = await put({ showToMembers: true, memberNotice: just });
        expect([ok.status, ok.body]).toEqual([200, { showToMembers: true, memberNotice: just }]);
        expect(upsertArgs().update.memberNotice).toBe(just);

        // 前後の空白を足して 200字を超えても、取ったあとが 200字なら保存できる
        const padded = await put({ showToMembers: false, memberNotice: `  ${just}\n` });
        expect([padded.status, padded.body]).toEqual([200, { showToMembers: false, memberNotice: just }]);
        expect(upsertArgs(1).update.memberNotice).toBe(just);
    });
});

// ================================================================ PUT: 注意書きの整え方

describe('PUT: 注意書きの整え方', () => {
    it('前後の空白（半角・全角・タブ・改行）を取って保存する。途中の空白・改行は、そのまま', async () => {
        const cases: [string, string][] = [
            ['  金額は、月を締めるまで変わることがあります  ', '金額は、月を締めるまで変わることがあります'],
            ['\t\n メモ \n', 'メモ'],
            ['　全角の空白　', '全角の空白'],
            ['  1行目\n2行目　3つめ  ', '1行目\n2行目　3つめ'],
        ];
        for (const [sent, saved] of cases) {
            mock(prisma.allowanceSetting.upsert).mockClear();
            mock(prisma.allowanceLog.create).mockClear();
            const r = await put({ showToMembers: true, memberNotice: sent });
            expect([sent, r.status, r.body]).toEqual([sent, 200, { showToMembers: true, memberNotice: saved }]);
            // 保存するのも、履歴に残すのも、空白を取ったあとの値
            expect([upsertArgs().create.memberNotice, upsertArgs().update.memberNotice]).toEqual([saved, saved]);
            expect(logArgs().data.detail.after).toEqual({ showToMembers: true, memberNotice: saved });
        }
    });

    it('null・空の注意書き・空白だけの注意書きは「注意書きなし」。今ある注意書きを消して、null で保存する（オン／オフは、送ったとおり）', async () => {
        const notices: (string | null)[] = [null, '', '   ', ' \n\t　'];
        for (const memberNotice of notices) {
            jest.clearAllMocks();
            settingRow({ showToMembers: true, memberNotice: '今の注意書き' });
            const r = await put({ showToMembers: true, memberNotice });
            expect([JSON.stringify(memberNotice), r.status, r.body]).toEqual([JSON.stringify(memberNotice), 200, { showToMembers: true, memberNotice: null }]);
            expect([JSON.stringify(memberNotice), dbCalls()]).toEqual([JSON.stringify(memberNotice), SAVE_CALLS]);
            expect(upsertArgs().create).toEqual({ id: 'default', showToMembers: true, memberNotice: null, updatedBy: 'admin1' });
            expect(upsertArgs().update).toEqual({ showToMembers: true, memberNotice: null, updatedBy: 'admin1' });
            expect(logArgs().data.detail).toEqual({
                before: { showToMembers: true, memberNotice: '今の注意書き' },
                after: { showToMembers: true, memberNotice: null },
            });
        }
    });
});

// ================================================================ PUT: 注意書きを省いたとき

describe('PUT: memberNotice を省いたとき（今の注意書きを残す）', () => {
    it('オン／オフだけを送ると、今の注意書きは残る。変わるのは showToMembers だけ（保存する中身・履歴・応答のどれも、今の注意書きのまま）', async () => {
        settingRow({ showToMembers: false, memberNotice: '今の注意書き' });
        const r = await put({ showToMembers: true });
        expect([r.status, r.body, r.cache]).toEqual([200, { showToMembers: true, memberNotice: '今の注意書き' }, 'no-store']);

        // 残す注意書きは、鍵を取ったあとで、トランザクションの中で読んだ「今の行」のもの
        expect(dbCalls()).toEqual(SAVE_CALLS);
        expect(upsertArgs().create).toEqual({ id: 'default', showToMembers: true, memberNotice: '今の注意書き', updatedBy: 'admin1' });
        expect(upsertArgs().update).toEqual({ showToMembers: true, memberNotice: '今の注意書き', updatedBy: 'admin1' });
        expect(logArgs().data.detail).toEqual({
            before: { showToMembers: false, memberNotice: '今の注意書き' },
            after: { showToMembers: true, memberNotice: '今の注意書き' },
        });
    });

    it('オンからオフにするときも同じ（注意書きは残る）', async () => {
        settingRow({ showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります' });
        const r = await put({ showToMembers: false });
        expect([r.status, r.body]).toEqual([200, { showToMembers: false, memberNotice: '金額は、月を締めるまで変わることがあります' }]);
        expect(upsertArgs().update).toEqual({ showToMembers: false, memberNotice: '金額は、月を締めるまで変わることがあります', updatedBy: 'admin1' });
    });

    it('オン／オフが今と同じなら、何も変わらないので、書かない・履歴も書かない（応答は今の中身）', async () => {
        const rows: NonNullable<SettingRow>[] = [
            { showToMembers: true, memberNotice: '今の注意書き' },
            { showToMembers: false, memberNotice: '今の注意書き' },
            { showToMembers: true, memberNotice: null },
        ];
        for (const row of rows) {
            jest.clearAllMocks();
            settingRow(row);
            const r = await put({ showToMembers: row.showToMembers });
            expect([JSON.stringify(row), r.status, r.body]).toEqual([JSON.stringify(row), 200, row]);
            expect([JSON.stringify(row), dbCalls()]).toEqual([JSON.stringify(row), UNCHANGED_CALLS]);
        }
    });

    it('今の行に注意書きが無ければ、省いて送っても「注意書きなし」のまま（null で保存する）', async () => {
        settingRow({ showToMembers: false, memberNotice: null });
        const r = await put({ showToMembers: true });
        expect([r.status, r.body]).toEqual([200, { showToMembers: true, memberNotice: null }]);
        expect(upsertArgs().update).toEqual({ showToMembers: true, memberNotice: null, updatedBy: 'admin1' });
        expect(logArgs().data.detail).toEqual({
            before: { showToMembers: false, memberNotice: null },
            after: { showToMembers: true, memberNotice: null },
        });
    });

    it('行が無いときに省いて送ると、「注意書きなし」（null）で作る（オン／オフが「オフ」＝同じ中身でも作る）', async () => {
        for (const showToMembers of [true, false]) {
            jest.clearAllMocks();
            settingRow(null);
            const r = await put({ showToMembers });
            expect([showToMembers, r.status, r.body]).toEqual([showToMembers, 200, { showToMembers, memberNotice: null }]);
            expect([showToMembers, dbCalls()]).toEqual([showToMembers, SAVE_CALLS]);
            expect(upsertArgs().where).toEqual({ id: 'default' });
            expect(upsertArgs().create).toEqual({ id: 'default', showToMembers, memberNotice: null, updatedBy: 'admin1' });
            expect(upsertArgs().update).toEqual({ showToMembers, memberNotice: null, updatedBy: 'admin1' });
            expect(logArgs().data.detail).toEqual({
                before: { showToMembers: false, memberNotice: null },
                after: { showToMembers, memberNotice: null },
            });
        }
    });

    it('省いたときと、null を送ったときは別（省く＝残す ／ null＝消す）。同じ行に、続けて送って見比べる', async () => {
        const row = { showToMembers: true, memberNotice: '今の注意書き' };
        settingRow(row);

        // 省く → 今と同じ中身なので、書かない
        expect((await put({ showToMembers: true })).body).toEqual(row);
        expect(prisma.allowanceSetting.upsert).not.toHaveBeenCalled();

        // null → 注意書きを消すので、書く
        expect((await put({ showToMembers: true, memberNotice: null })).body).toEqual({ showToMembers: true, memberNotice: null });
        expect(prisma.allowanceSetting.upsert).toHaveBeenCalledTimes(1);
        expect(upsertArgs().update.memberNotice).toBeNull();
    });
});

// ================================================================ PUT: 保存

describe('PUT: 中身が変わったとき（設定と履歴を、同じトランザクションで書く）', () => {
    it('トランザクションの中で「鍵を取る → 今の行を読む → 設定を書く（upsert）→ 履歴を書く」。応答は保存した中身（no-store）', async () => {
        const r = await put({ showToMembers: true, memberNotice: '  金額は、月を締めるまで変わることがあります  ' });
        expect([r.status, r.body, r.cache]).toEqual([200, { showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります' }, 'no-store']);

        // 鍵も、読むのも書くのも、全部トランザクションの中（tx）。順番もこのとおり・どれも1回ずつ
        // （鍵を取る前に今の行を読むと、同時に保存した相手の「前の行」と見比べてしまう）
        expect(dbCalls()).toEqual(SAVE_CALLS);

        // 鍵は、手当のほかの書き込み（記録を足す・月を締める など）と同じ鍵
        expect(lockSqls()).toEqual([LOCK_SQL]);
        // トランザクションの設定を渡す（鍵が空くのを待つ時間も、トランザクションの時間に入るため）
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 10000 });

        // 今の行は、id が 'default' の1行の「オン／オフ」と「注意書き」を読む（同じ中身かどうかを比べるのに、両方が要る）
        expect(prisma.allowanceSetting.findUnique).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceSetting.findUnique).toHaveBeenCalledWith({
            where: { id: 'default' },
            select: { showToMembers: true, memberNotice: true },
        });

        // 設定: 行が無ければ作る・あれば直す（どちらも同じ中身。直した人は、操作した人の ID）
        expect(prisma.allowanceSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'default' },
            create: { id: 'default', showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります', updatedBy: 'admin1' },
            update: { showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります', updatedBy: 'admin1' },
        }));

        // 履歴: setting_updated・操作した人（ID と名前）・変える前と後
        expect(prisma.allowanceLog.create).toHaveBeenCalledWith({
            data: {
                action: 'setting_updated',
                actorId: 'admin1',
                actorName: '管理者1',
                detail: {
                    before: { showToMembers: false, memberNotice: null },
                    after: { showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります' },
                },
            },
        });
    });

    it('オン／オフだけ・注意書きだけ、どちらか片方が変わっただけでも書く（履歴の before は今の行・after は送った中身）', async () => {
        const cases: [string, NonNullable<SettingRow>, NonNullable<SettingRow>][] = [
            ['オフ → オン（注意書きは同じ）', { showToMembers: false, memberNotice: 'メモ' }, { showToMembers: true, memberNotice: 'メモ' }],
            ['オン → オフ（注意書きは無いまま）', { showToMembers: true, memberNotice: null }, { showToMembers: false, memberNotice: null }],
            ['注意書きを変える（オンのまま）', { showToMembers: true, memberNotice: '前の注意書き' }, { showToMembers: true, memberNotice: '新しい注意書き' }],
            ['注意書きを足す（オフのまま）', { showToMembers: false, memberNotice: null }, { showToMembers: false, memberNotice: '準備中です' }],
            ['注意書きを消す（オンのまま）', { showToMembers: true, memberNotice: '前の注意書き' }, { showToMembers: true, memberNotice: null }],
            ['両方を変える', { showToMembers: true, memberNotice: '前の注意書き' }, { showToMembers: false, memberNotice: '新しい注意書き' }],
        ];
        for (const [label, before, after] of cases) {
            jest.clearAllMocks();
            settingRow(before);
            const r = await put(after);
            expect([label, r.status, r.body]).toEqual([label, 200, after]);
            expect([label, dbCalls()]).toEqual([label, SAVE_CALLS]);
            expect([label, upsertArgs().update]).toEqual([label, { ...after, updatedBy: 'admin1' }]);
            expect([label, upsertArgs().create]).toEqual([label, { id: 'default', ...after, updatedBy: 'admin1' }]);
            expect([label, logArgs().data.detail]).toEqual([label, { before, after }]);
        }
    });

    it("行が無いときは、同じ中身（オフ・注意書きなし）でも作る（upsert する）。履歴の before は「見せない・注意書きなし」", async () => {
        settingRow(null);
        const r = await put({ showToMembers: false, memberNotice: null });
        expect([r.status, r.body]).toEqual([200, { showToMembers: false, memberNotice: null }]);

        expect(dbCalls()).toEqual(SAVE_CALLS);
        expect(upsertArgs().where).toEqual({ id: 'default' });
        expect(upsertArgs().create).toEqual({ id: 'default', showToMembers: false, memberNotice: null, updatedBy: 'admin1' });
        expect(logArgs().data.detail).toEqual({
            before: { showToMembers: false, memberNotice: null },
            after: { showToMembers: false, memberNotice: null },
        });
    });

    it('行が無いときに、オン・注意書きありで保存しても、同じように作る', async () => {
        settingRow(null);
        const r = await put({ showToMembers: true, memberNotice: 'はじめての注意書き' });
        expect([r.status, r.body]).toEqual([200, { showToMembers: true, memberNotice: 'はじめての注意書き' }]);
        expect(dbCalls()).toEqual(SAVE_CALLS);
        expect(upsertArgs().create).toEqual({ id: 'default', showToMembers: true, memberNotice: 'はじめての注意書き', updatedBy: 'admin1' });
        expect(logArgs().data.detail).toEqual({
            before: { showToMembers: false, memberNotice: null },
            after: { showToMembers: true, memberNotice: 'はじめての注意書き' },
        });
    });

    it('履歴の actorId・設定の updatedBy は、セッションの ID。actorName は名前（名前が無いセッションでは、ログイン名。ID ではない）', async () => {
        loginAs({ id: 'admin2', role: 'admin', name: '管理者2' });
        await put({ showToMembers: true, memberNotice: null });
        expect([logArgs().data.actorId, logArgs().data.actorName]).toEqual(['admin2', '管理者2']);
        expect([upsertArgs().create.updatedBy, upsertArgs().update.updatedBy]).toEqual(['admin2', 'admin2']);

        // 名前が入っていないセッション
        loginAs({ id: 'admin3', role: 'admin' });
        await put({ showToMembers: true, memberNotice: null });
        expect([logArgs(1).data.actorId, logArgs(1).data.actorName]).toEqual(['admin3', 'login-admin3']);
        expect([upsertArgs(1).create.updatedBy, upsertArgs(1).update.updatedBy]).toEqual(['admin3', 'admin3']);
    });

    it('余分な項目（id・updatedBy など）を送っても、保存するのは showToMembers・memberNotice だけ（行は、いつも id が default の1行）', async () => {
        const r = await put({
            showToMembers: true, memberNotice: 'メモ',
            id: 'another', updatedBy: 'someone-else', updatedAt: '2000-01-01T00:00:00.000Z', actorId: 'someone-else', action: 'hacked',
        });
        expect([r.status, r.body]).toEqual([200, { showToMembers: true, memberNotice: 'メモ' }]);
        expect(upsertArgs().where).toEqual({ id: 'default' });
        expect(upsertArgs().create).toEqual({ id: 'default', showToMembers: true, memberNotice: 'メモ', updatedBy: 'admin1' });
        expect(upsertArgs().update).toEqual({ showToMembers: true, memberNotice: 'メモ', updatedBy: 'admin1' });
        expect(logArgs()).toEqual({
            data: {
                action: 'setting_updated', actorId: 'admin1', actorName: '管理者1',
                detail: { before: { showToMembers: false, memberNotice: null }, after: { showToMembers: true, memberNotice: 'メモ' } },
            },
        });
    });

    it('大文字のロール（ADMIN）でも、管理者として保存できる', async () => {
        loginAs({ id: 'admin1', role: 'ADMIN', name: '管理者1' });
        const r = await put({ showToMembers: true, memberNotice: null });
        expect([r.status, r.body]).toEqual([200, { showToMembers: true, memberNotice: null }]);
        expect(dbCalls()).toEqual(SAVE_CALLS);
    });
});

describe('PUT: 中身が今と同じとき（書かない・履歴も書かない）', () => {
    it('今の行と同じ中身なら、鍵を取って今の行を読むだけ。応答は今の中身（200・no-store）', async () => {
        settingRow({ showToMembers: true, memberNotice: 'メモ' });
        const r = await put({ showToMembers: true, memberNotice: 'メモ' });
        expect([r.status, r.body, r.cache]).toEqual([200, { showToMembers: true, memberNotice: 'メモ' }, 'no-store']);

        // 鍵を取って、今の行をトランザクションの中で読む。そのうえで、設定も履歴も書かない
        expect(dbCalls()).toEqual(UNCHANGED_CALLS);
        expect(lockSqls()).toEqual([LOCK_SQL]);
        expect(transactionOptions()).toEqual([TX_OPTIONS]);
        expect(prisma.allowanceSetting.upsert).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    });

    it('同じかどうかは、注意書きを整えたあとの値で比べる（前後の空白が付いているだけ・空と null の違いだけなら、同じ中身）', async () => {
        const cases: [string, NonNullable<SettingRow>, Record<string, unknown>][] = [
            ['前後に空白が付いているだけ', { showToMembers: true, memberNotice: 'メモ' }, { showToMembers: true, memberNotice: '  メモ\n' }],
            ['注意書きなしに、空の文字を送る', { showToMembers: false, memberNotice: null }, { showToMembers: false, memberNotice: '' }],
            ['注意書きなしに、空白だけを送る', { showToMembers: false, memberNotice: null }, { showToMembers: false, memberNotice: '   ' }],
            ['注意書きなしに、null を送る', { showToMembers: true, memberNotice: null }, { showToMembers: true, memberNotice: null }],
        ];
        for (const [label, row, body] of cases) {
            jest.clearAllMocks();
            settingRow(row);
            const r = await put(body);
            expect([label, r.status, r.body]).toEqual([label, 200, row]);
            expect([label, dbCalls()]).toEqual([label, UNCHANGED_CALLS]);
        }
    });

    it('同じ中身を2回続けて保存しても、書くのは1回目だけ（2回目は、1回目で保存した行と同じなので書かない）', async () => {
        const body = { showToMembers: true, memberNotice: 'メモ' };
        expect((await put(body)).status).toBe(200);
        expect(dbCalls()).toEqual(SAVE_CALLS);

        // 1回目で保存した中身が、今の行になっている
        settingRow(body);
        expect((await put(body)).body).toEqual(body);
        expect(dbCalls()).toEqual([...SAVE_CALLS, ...UNCHANGED_CALLS]);
        expect(prisma.allowanceSetting.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        // 鍵とトランザクションの設定は、書くときも・書かないときも同じ
        expect(lockSqls()).toEqual([LOCK_SQL, LOCK_SQL]);
        expect(transactionOptions()).toEqual([TX_OPTIONS, TX_OPTIONS]);
    });
});

// ================================================================ PUT: 例外

describe('PUT: 例外（500。保存できたことにしない）', () => {
    it('鍵を取るときに例外（鍵が空くのを待ちきれなかった など）→ 500。今の行も読まない・設定も履歴も書かない', async () => {
        const boom = new Error('鍵が取れない');
        mock(prisma.$executeRaw).mockRejectedValue(boom);
        const r = await put({ showToMembers: true, memberNotice: null });
        expect(r.status).toBe(500);
        expect(r.body.showToMembers).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledTimes(1);
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の公開の設定の保存', boom);
        expect(dbCalls()).toEqual(['prisma.$transaction', 'tx.$executeRaw']);
    });

    it('今の行を読むときに例外 → 500。設定も履歴も書かない', async () => {
        const boom = new Error('DB に届かない');
        mock(prisma.allowanceSetting.findUnique).mockRejectedValue(boom);
        const r = await put({ showToMembers: true, memberNotice: null });
        expect(r.status).toBe(500);
        expect(r.body.showToMembers).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledTimes(1);
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の公開の設定の保存', boom);
        expect(dbCalls()).toEqual(UNCHANGED_CALLS);
    });

    it('設定を書くときに例外 → 500。履歴は書かない', async () => {
        const boom = new Error('書けない');
        mock(prisma.allowanceSetting.upsert).mockRejectedValue(boom);
        const r = await put({ showToMembers: true, memberNotice: null });
        expect(r.status).toBe(500);
        expect(r.body.showToMembers).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の公開の設定の保存', boom);
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    });

    it('履歴を書くときに例外 → 500（履歴が残せなければ、保存できたという応答にしない）', async () => {
        const boom = new Error('履歴が書けない');
        mock(prisma.allowanceLog.create).mockRejectedValue(boom);
        const r = await put({ showToMembers: true, memberNotice: null });
        expect(r.status).toBe(500);
        expect(r.body.showToMembers).toBeUndefined();
        expect(serverErrorResponse).toHaveBeenCalledWith('手当の公開の設定の保存', boom);
        // 設定と履歴は、同じトランザクションの中（本物の DB では、履歴が書けなければ、設定の書き込みも取り消される）
        expect(dbCalls()).toEqual(SAVE_CALLS);
    });
});

// ================================================================ 設定

describe('設定', () => {
    it("毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'）", () => {
        expect(dynamic).toBe('force-dynamic');
    });
});
