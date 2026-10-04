/**
 * @jest-environment node
 *
 * GET・POST /api/allowances/crosscheck（手当の「手配と見比べる」）のテスト。
 *
 *   GET  … 手当ごとに、手配と出勤簿から「手当が付くはずの人と日」を作り、実際の記録と見比べた結果を返す
 *   POST … 「付くはずなのに記録が無い」分（missing）の中から選んだ分を、まとめて付ける
 *
 * route は lib/allowancesServer.ts・lib/allowances.ts の関数を本物のまま呼ぶ。
 * 差し替えているのは、jest.setup.ts の @/lib/prisma と @/lib/api/utils だけ。
 * prisma のモックは where・select を見ずに、テストが決めた答えを返すだけなので、
 * 「絞り込みが正しいか」「必要な列を読んでいるか」は、返ってきた値ではなく、findMany などに渡した引数で確かめる。
 *
 * 日付の形（本番の DB と同じ）:
 *   - 手配（ProjectAssignment.date）… 日本時間のその日の 0時 ＝ UTC では前日の 15時（jst0）
 *   - 出勤簿・手当の記録・金額の適用開始日 … UTC 0時の印（utc0）
 * 使う日付は 2026年9月の過去の日。「今日」を日本時間で決めているかを確かめるテストだけ、時計を固定する（freezeNow）。
 *
 * ── 9月の例（beforeEach が入れる。操作している人は 管理者1。手配は、どれも工事内容が「大規模」の現場）──
 *
 *   現場（案件）は2つ: 「駅前タワー 大規模修繕」（9/1・9/2・9/10）と「第二小学校 外壁」（9/3）
 *
 *   9/1   手配:   職長A の班（作業員1・作業員2・協力会社のメンバー1）
 *         出勤簿: 職長A 出勤／作業員1 出勤／作業員2 有給／協力会社のメンバー1 出勤
 *         記録:   r1 職長A（職長・確認待ち）／r2 作業員2（職長以外）
 *   9/2   手配:   職長A の班（作業員1）
 *         出勤簿: 職長A 夜勤／作業員1 休日出勤
 *         記録:   r3 職長A（職長以外）／r4 作業員1（職長）
 *   9/3   手配:   職長B の班（作業員2）
 *         出勤簿: 職長B 出勤／作業員2 出勤
 *         記録:   r5 作業員2（職長以外）
 *   9/5   手配:   なし
 *         記録:   r6 作業員3（職長以外）
 *   9/10  手配:   職長B の班（職長A・管理者1・作業員1）
 *         出勤簿: 職長B 出勤／職長A 出勤／管理者1 出勤（作業員1 は出勤簿なし）
 *         記録:   r7 User の行が無い人（職長以外）
 *
 *   金額: 9/1 から 職長 1,500円・職長以外 200円 ／ 9/10 から 職長 2,000円・職長以外 300円
 *         （いちばん古い適用開始日 9/1 が、この手当の「始まりの日」。それより前の日には付けられない）
 *
 *   見比べた結果:
 *     missing（付くはずなのに記録が無い）… 作業員1 9/1・職長B 9/3・管理者1 9/10・職長A 9/10（この日は職長以外）・職長B 9/10
 *     extra（記録はあるが付くはずでない）… r2（出勤していない）・r6（手配に入っていない）・r7（手配に入っていない）
 *     mismatch（職長／職長以外が違う）  … r3（手配では職長）・r4（手配では職長以外）
 *     unworked（出勤簿が出勤でない）    … 作業員2 9/1（有給）・作業員1 9/10（出勤簿なし）
 *     sites（対象として数えた現場）      … 駅前タワー 大規模修繕 3日・第二小学校 外壁 1日
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST, dynamic } from '@/app/api/allowances/crosscheck/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;
/** モックの答えを決め直す（前のテストが決めた答えや、使い残した mockResolvedValueOnce を消してから） */
const answer = (fn: unknown, value: unknown) => mock(fn).mockReset().mockResolvedValue(value);
/** そのモックの call 回目（0 始まり）の呼び出しに渡した、1つめの引数 */
const argsOf = <T = unknown>(fn: unknown, call = 0) => mock(fn).mock.calls[call][0] as T;
/** そのモックの call 回目の呼び出しが、全部のモックを通して何番目だったか（呼んだ順番を比べる用） */
const orderOf = (fn: unknown, call = 0) => mock(fn).mock.invocationCallOrder[call];

const MONTH = '2026-09';
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);
/** 手配の日時: 日本時間のその日の 0時（UTC では前日の 15時） */
const jst0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000+09:00`);

// ---------------------------------------------------------------- 応答の形

interface MissingBody { key: string; userId: string; userName: string; date: string; payRole: string; amount: number; isSelf: boolean }
interface RecordBody { recordId: string; userId: string; userName: string; date: string; payRole: string; amount: number; status: string; createdByName: string }
interface UnworkedBody { userId: string; userName: string; date: string; payRole: string; attendanceStatus: string | null }
interface PersonBody { userId: string; userName: string; expectedForemanDays: number; expectedMemberDays: number; recordedForemanDays: number; recordedMemberDays: number }
interface SiteBody { projectMasterId: string; title: string; days: number }
interface ItemBody {
    itemId: string; itemName: string; isActive: boolean; constructionContent: string;
    expectedCount: number; recordCount: number;
    sites: SiteBody[];
    missing: MissingBody[];
    extra: (RecordBody & { reason: string })[];
    mismatch: (RecordBody & { expectedPayRole: string })[];
    unworked: UnworkedBody[];
    people: PersonBody[];
}
interface GetBody { month?: string; closed?: boolean; items?: ItemBody[]; error?: string; details?: string }
interface PostBody { added?: number; pending?: number; skipped?: number; error?: string; details?: string }

// ---------------------------------------------------------------- findMany などに渡した引数の形（確かめるところだけ）

interface DateRange { gte: Date; lt: Date }
interface UserArgs { where: { id: { in: string[] } }; select: unknown }
interface AttendanceArgs { where: { userId: { in: string[] }; date: DateRange }; select: unknown }
interface RecordArgs { where: { itemId: string; date: DateRange } }
interface InsertArgs { data: Record<string, unknown>[]; skipDuplicates?: boolean }

// ---------------------------------------------------------------- 呼び出し

const get = async (query: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/allowances/crosscheck${query ? `?${query}` : ''}`));
    return { status: res.status, body: (await res.json()) as GetBody, res };
};

/** GET した応答の、index 番目の手当（200 でない・手当が無いときは、その場でテストを落とす） */
const getItem = async (index = 0): Promise<ItemBody> => {
    const r = await get(`month=${MONTH}`);
    const item = r.body.items?.[index];
    if (r.status !== 200 || !item) throw new Error(`GET の応答に items[${index}] がありません: ${r.status} ${JSON.stringify(r.body)}`);
    return item;
};

const postRaw = async (rawBody: string) => {
    const res = await POST(new NextRequest('http://localhost/api/allowances/crosscheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
    }));
    return { status: res.status, body: (await res.json()) as PostBody, res };
};

/** 9月の例で「付くはずなのに記録が無い」人と日（GET の missing[].key。日付の古い順 → 人の ID 順） */
const MISSING_KEYS = ['worker1|2026-09-01', 'foremanB|2026-09-03', 'admin1|2026-09-10', 'foremanA|2026-09-10', 'foremanB|2026-09-10'];

/** 何も指定しなければ、9月の例の missing を全部付ける */
const post = (over: Record<string, unknown> = {}) => postRaw(JSON.stringify({ itemId: 'large', month: MONTH, keys: MISSING_KEYS, ...over }));

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

// ---------------------------------------------------------------- DB が返す行

/** 現場（案件 ProjectMaster）。id = 手配の行の projectMasterId、title = 案件の名前 */
interface Site { id: string; title: string }
const TOWER: Site = { id: 'pm-tower', title: '駅前タワー 大規模修繕' };
const SCHOOL: Site = { id: 'pm-school', title: '第二小学校 外壁' };
/** 現場を指定しなかった手配の現場: 工事内容が「大規模」なら 駅前タワー、ほかは工事内容ごとに別の案件 */
const siteOf = (content: string | null): Site =>
    content === '大規模' ? TOWER : { id: `pm-${content ?? 'none'}`, title: `${content ?? '工事内容なし'}の現場` };

/**
 * 手配の1件（ProjectAssignment）。workerIds = 手配確定のメンバー（JSON の文字列で入っている）。
 * content = その案件の工事内容。site = その案件（現場）
 */
const assignment = (foremanId: string, dateKey: string, workerIds: unknown[] | null, content: string | null = '大規模', site: Site = siteOf(content)) => ({
    assignedEmployeeId: foremanId,
    date: jst0(dateKey),
    confirmedWorkerIds: workerIds === null ? null : JSON.stringify(workerIds),
    projectMasterId: site.id,
    projectMaster: { title: site.title, constructionContent: content },
});

/** 手配の行を読むときに渡すはずの select（職長・日時・手配確定のメンバー・案件の ID・案件の名前と工事内容） */
const ASSIGNMENT_SELECT = {
    assignedEmployeeId: true,
    date: true,
    confirmedWorkerIds: true,
    projectMasterId: true,
    projectMaster: { select: { title: true, constructionContent: true } },
};

/** 出勤簿の1行（AttendanceRecord） */
const attendance = (userId: string, dateKey: string, status: string) => ({ userId, date: utc0(dateKey), status });
/** その日、その人たちが「出勤」 */
const present = (dateKey: string, ...userIds: string[]) => userIds.map((userId) => attendance(userId, dateKey, 'present'));

/** 手当の記録の1行（AllowanceRecord のうち、見比べで読む列） */
const record = (id: string, userId: string, dateKey: string, payRole: 'foreman' | 'member', over: Record<string, unknown> = {}) => ({
    id, userId, date: utc0(dateKey), payRole, amount: payRole === 'foreman' ? 1500 : 200, status: 'confirmed', createdByName: '管理者1', ...over,
});

const LARGE = { id: 'large', name: '大規模手当', isActive: true, constructionContent: '大規模' };

/** 大規模手当の金額: 9/1 から 職長 1,500円・職長以外 200円 ／ 9/10 から 職長 2,000円・職長以外 300円 */
const RATES = [
    { id: 'rate1', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-08-25T01:00:00.000Z') },
    { id: 'rate2', itemId: 'large', foremanAmount: 2000, memberAmount: 300, effectiveFrom: utc0('2026-09-10'), createdAt: new Date('2026-09-05T01:00:00.000Z') },
];

/** 月の途中（9/10）に始まる手当の金額（9/10 からの1行だけ）＝ 9/9 までは「手当が始まる前の日」 */
const RATES_FROM_10TH = [RATES[1]];

/** 金額の履歴を読むときに渡すはずの引数（その手当の分だけ） */
const rateArgs = (itemId: string) => ({
    where: { itemId: { in: [itemId] } },
    select: { id: true, itemId: true, foremanAmount: true, memberAmount: true, effectiveFrom: true, createdAt: true },
});

/** User の行（role は DB の値のまま＝大文字が混ざる）。'ghost' は、わざと入れていない（User の行が無い人） */
const USERS = [
    { id: 'worker2', displayName: '作業員2', role: 'worker', dispatchSortOrder: 4 },
    { id: 'foremanA', displayName: '職長A', role: 'FOREMAN2', dispatchSortOrder: 2 },
    { id: 'admin1', displayName: '管理者1', role: 'ADMIN', dispatchSortOrder: 5 },
    { id: 'foremanB', displayName: '職長B', role: 'FOREMAN1', dispatchSortOrder: 1 },
    { id: 'worker1', displayName: '作業員1', role: 'WORKER', dispatchSortOrder: 3 },
    { id: 'manager1', displayName: 'マネージャー1', role: 'MANAGER', dispatchSortOrder: 6 },
    { id: 'worker3', displayName: '作業員3', role: 'WORKER', dispatchSortOrder: 7 },
    { id: 'partnerBoss', displayName: '協力会社', role: 'PARTNER', dispatchSortOrder: 8 },
    { id: 'partner1', displayName: '協力会社のメンバー1', role: 'PARTNER_MEMBER', dispatchSortOrder: 9 },
    { id: 'partner2', displayName: '協力会社のメンバー2', role: 'partner_member', dispatchSortOrder: 10 },
];

/** 9月の例（中身と、見比べた結果は、ファイルの先頭のコメントを参照） */
const EXAMPLE = {
    assignments: [
        assignment('foremanA', '2026-09-01', ['worker1', 'worker2', 'partner1']),
        assignment('foremanA', '2026-09-02', ['worker1']),
        assignment('foremanB', '2026-09-03', ['worker2'], '大規模', SCHOOL),
        assignment('foremanB', '2026-09-10', ['foremanA', 'admin1', 'worker1']),
    ],
    attendance: [
        attendance('foremanA', '2026-09-01', 'present'),
        attendance('worker1', '2026-09-01', 'present'),
        attendance('worker2', '2026-09-01', 'paid_leave'),
        attendance('partner1', '2026-09-01', 'present'),
        attendance('foremanA', '2026-09-02', 'night_shift'),
        attendance('worker1', '2026-09-02', 'holiday_work'),
        attendance('foremanB', '2026-09-03', 'present'),
        attendance('worker2', '2026-09-03', 'present'),
        attendance('foremanB', '2026-09-10', 'present'),
        attendance('foremanA', '2026-09-10', 'present'),
        attendance('admin1', '2026-09-10', 'present'),
        // 作業員1 の 9/10 は、出勤簿が無い
    ],
    // DB が返す順（日付の古い順 → 付けた順）
    records: [
        record('r1', 'foremanA', '2026-09-01', 'foreman', { status: 'pending', createdByName: '職長A' }),
        record('r2', 'worker2', '2026-09-01', 'member', { createdByName: '職長A' }),
        record('r3', 'foremanA', '2026-09-02', 'member'),
        record('r4', 'worker1', '2026-09-02', 'foreman'),
        record('r5', 'worker2', '2026-09-03', 'member'),
        record('r6', 'worker3', '2026-09-05', 'member'),
        record('r7', 'ghost', '2026-09-10', 'member', { amount: 300 }),
    ],
};

/** 見比べの材料（手配・出勤簿・その手当の記録）を、DB が返す形で決める。書かなかったものは空 */
const setWorld = (world: { assignments?: unknown[]; attendance?: unknown[]; records?: unknown[] }) => {
    answer(prisma.projectAssignment.findMany, world.assignments ?? []);
    answer(prisma.attendanceRecord.findMany, world.attendance ?? []);
    answer(prisma.allowanceRecord.findMany, world.records ?? []);
};

/** DB が「入った行」として返す形（id など、DB が埋める列を足す） */
const asInserted = (data: Record<string, unknown>[]): Record<string, unknown>[] => data.map((d, i) => ({
    id: `new-${i + 1}`, confirmedBy: null, confirmedByName: null, confirmedAt: null,
    createdAt: new Date('2026-10-02T03:00:00.000Z'), updatedAt: new Date('2026-10-02T03:00:00.000Z'), ...d,
}));

/** createManyAndReturn に渡すはずの data の1行（「手配と見比べる」から入れる記録） */
const newRow = (
    userId: string, dateKey: string, payRole: 'foreman' | 'member', amount: number, rateId: string, status: 'confirmed' | 'pending',
    by: { id: string; name: string } = ADMIN,
) => ({
    userId, date: utc0(dateKey), itemId: 'large', itemName: '大規模手当', payRole, amount, rateId,
    status, source: 'bulk', foremanId: null, note: null, createdBy: by.id, createdByName: by.name,
});

/** createManyAndReturn に渡した引数（1回だけ呼んでいること） */
const insertArgs = () => {
    expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
    return argsOf<InsertArgs>(prisma.allowanceRecord.createManyAndReturn);
};

/** 手当の書き込みの鍵（$executeRaw に渡した SQL） */
const lockSqls = () => mock(prisma.$executeRaw).mock.calls.map((c) => Array.from(c[0] as readonly string[]).join('?'));

// ---------------------------------------------------------------- 「していないこと」の確かめ

/** DB を何も読んでいないこと */
const noReads = () => {
    expect(prisma.allowanceItem.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.allowanceMonthClose.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
    expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
};

/** 見比べの材料（手配・記録・金額・人・出勤簿）を読んでいないこと */
const noCrosscheckReads = () => {
    expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
};

/** 記録も履歴も、何も書いていないこと（トランザクションも開いていない・鍵も取っていない） */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.createMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.create).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.allowanceRecord.deleteMany).not.toHaveBeenCalled();
    expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
    expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
};

beforeEach(() => {
    jest.clearAllMocks();
    // requireAuth の既定のモックには name・username が無いので、テストごとに入れる
    loginAs(ADMIN);

    answer(prisma.allowanceItem.findMany, [LARGE]);
    answer(prisma.allowanceItem.findUnique, LARGE);
    answer(prisma.allowanceMonthClose.findMany, []);   // どの月も締めていない
    answer(prisma.allowanceRate.findMany, RATES);
    // モックは where を見ない。「DB が絞ったあとの結果」を、テストが決めて返す
    answer(prisma.user.findMany, USERS);
    setWorld(EXAMPLE);

    // createManyAndReturn は「入った行の配列」を返すようにする（何もしなければ、渡した行が全部入る）
    mock(prisma.allowanceRecord.createManyAndReturn).mockReset().mockImplementation(async ({ data }: InsertArgs) => asInserted(data));
    answer(prisma.allowanceLog.createMany, { count: 0 });
});

afterEach(() => {
    jest.useRealTimers();
    // 見比べは、出勤簿・手配・人を「読むだけ」。どのテストでも、書いていないこと
    expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.upsert).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.delete).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.deleteMany).not.toHaveBeenCalled();
    expect(prisma.projectAssignment.create).not.toHaveBeenCalled();
    expect(prisma.projectAssignment.update).not.toHaveBeenCalled();
    expect(prisma.projectAssignment.delete).not.toHaveBeenCalled();
    expect(prisma.projectAssignment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
});

// ================================================================ ログインと権限

describe('ログインと権限（GET・POST とも）: 管理者・マネージャーだけ', () => {
    it('ログインしていなければ 401。何も読まない・書かない', async () => {
        // 2回呼ぶので、応答は呼ばれるたびに作る（同じ応答の body は、1回しか読めない）
        mock(requireAuth).mockImplementation(async () => ({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }));
        expect((await get(`month=${MONTH}`)).status).toBe(401);
        expect((await post()).status).toBe(401);
        noReads();
        noWrites();
    });

    it('職長・作業員・協力会社・税理士は 403「権限がありません」（自分が職長の班の分でも）。何も読まない・書かない', async () => {
        const users = [
            { id: 'foremanA', role: 'foreman2', name: '職長A' },
            { id: 'foremanB', role: 'foreman1', name: '職長B' },
            { id: 'worker1', role: 'worker', name: '作業員1' },
            { id: 'partnerBoss', role: 'partner', name: '協力会社' },
            { id: 'partner1', role: 'partner_member', name: '協力会社のメンバー1' },
            { id: 'accountant1', role: 'accountant', name: '税理士' },
            { id: 'nobody', role: '', name: 'ロールなし' },
        ];
        for (const user of users) {
            loginAs(user);
            for (const r of [await get(`month=${MONTH}`), await post()]) {
                expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
            }
        }
        noReads();
        noWrites();
    });

    it('マネージャーも使える（GET は 200。POST で付けた人として残るのはマネージャー）', async () => {
        loginAs(MANAGER);
        expect((await get(`month=${MONTH}`)).status).toBe(200);

        const r = await post({ keys: ['worker1|2026-09-01'] });
        expect([r.status, r.body]).toEqual([200, { added: 1, pending: 0, skipped: 0 }]);
        expect(insertArgs().data).toEqual([newRow('worker1', '2026-09-01', 'member', 200, 'rate1', 'confirmed', MANAGER)]);
    });
});

// ================================================================ GET

describe('GET: 月の指定', () => {
    it('month が無い → 400「入力が不正です」／形が違う → 400「月が不正です」。何も読まない', async () => {
        // 形のまちがいは validationErrorResponse。モックでは、文言が error ではなく details に入る
        for (const query of ['', 'itemId=large']) {
            const r = await get(query);
            expect([query, r.status, r.body.error, r.body.details]).toEqual([query, 400, 'Validation Error', '入力が不正です']);
        }
        // 年は 2000〜2999 だけ（'0026-09' のような年は、Date が 1926年と読んでしまうので受け付けない）
        for (const month of ['2026-13', '2026-00', '2026-9', '202609', '2026/09', '2026-09-01', ' 2026-09', '', '0026-09', '1999-12', '3000-01']) {
            const r = await get(`month=${encodeURIComponent(month)}`);
            expect([month, r.status, r.body.details]).toEqual([month, 400, '月が不正です']);
        }
        noReads();
    });

    it('年が 2000〜2999 の月は受け付ける（2000-01・2999-12）', async () => {
        for (const month of ['2000-01', '2999-12']) {
            const r = await get(`month=${month}`);
            expect([month, r.status, r.body.month]).toEqual([month, 200, month]);
        }
    });
});

describe('GET: 応答の外側（month・closed・items）', () => {
    it('手当は全部（使っていない手当も）、DB から読んだ順（sortOrder → 作った順）で返す', async () => {
        const OLD = { id: 'old', name: '遠方手当（旧）', isActive: false, constructionContent: '改修' };
        answer(prisma.allowanceItem.findMany, [OLD, LARGE]);
        setWorld({});

        const r = await get(`month=${MONTH}`);
        expect([r.status, r.body.month]).toEqual([200, MONTH]);
        expect((r.body.items ?? []).map((i) => [i.itemId, i.itemName, i.isActive, i.constructionContent])).toEqual([
            ['old', '遠方手当（旧）', false, '改修'],
            ['large', '大規模手当', true, '大規模'],
        ]);
        // 並びと「全部を読む」は、モックが見ないので、渡した引数で確かめる（where で使用中だけに絞っていない）
        expect(prisma.allowanceItem.findMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceItem.findMany)).toEqual({
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, name: true, isActive: true, constructionContent: true },
        });
        // 金額は、見比べの中で、手当ごとに1回ずつ読む（その手当の分だけ）
        expect(mock(prisma.allowanceRate.findMany).mock.calls.map((c) => c[0] as unknown)).toEqual([rateArgs('old'), rateArgs('large')]);
    });

    it('closed は、その月が締めてあるか（締めた月の表を、その月で引く）。締めてあっても、見比べの結果は返す', async () => {
        const open = await get(`month=${MONTH}`);
        expect([open.status, open.body.closed]).toEqual([200, false]);
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceMonthClose.findMany)).toEqual({ where: { month: { in: [MONTH] } }, select: { month: true } });

        answer(prisma.allowanceMonthClose.findMany, [{ month: MONTH }]);
        const closed = await get(`month=${MONTH}`);
        expect([closed.status, closed.body.closed]).toEqual([200, true]);
        expect(closed.body.items).toEqual(open.body.items);
        expect(closed.body.items?.[0]?.missing.map((m) => m.key)).toEqual(MISSING_KEYS);
    });

    it('手配も記録も無い月は、どれも空で返す（人・出勤簿は読まない）。手当が1つも無ければ items は空', async () => {
        setWorld({});
        const empty = await get(`month=${MONTH}`);
        expect([empty.status, empty.body]).toEqual([200, {
            month: MONTH,
            closed: false,
            items: [{
                itemId: 'large', itemName: '大規模手当', isActive: true, constructionContent: '大規模',
                expectedCount: 0, recordCount: 0, sites: [], missing: [], extra: [], mismatch: [], unworked: [], people: [],
            }],
        }]);
        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();

        answer(prisma.allowanceItem.findMany, []);
        const noItems = await get(`month=${MONTH}`);
        expect([noItems.status, noItems.body]).toEqual([200, { month: MONTH, closed: false, items: [] }]);
    });

    it('手当が2つあるときは、手当ごとに「自分の対象の工事内容・自分の記録・自分の金額」で見比べる', async () => {
        const RENOVATION = { id: 'renov', name: '改修手当', isActive: false, constructionContent: '改修' };
        answer(prisma.allowanceItem.findMany, [LARGE, RENOVATION]);
        answer(prisma.allowanceRate.findMany, [
            ...RATES,
            { id: 'rateR', itemId: 'renov', foremanAmount: 800, memberAmount: 100, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-08-25T01:00:00.000Z') },
        ]);
        // 9/1: 職長A の班（作業員1）は「大規模」の現場、職長B の班（作業員2）は「改修」の現場。4人とも出勤
        setWorld({
            assignments: [assignment('foremanA', '2026-09-01', ['worker1']), assignment('foremanB', '2026-09-01', ['worker2'], '改修')],
            attendance: present('2026-09-01', 'foremanA', 'worker1', 'foremanB', 'worker2'),
        });
        // 記録だけは、手当ごとに違う答えを返す（where の itemId を見る）
        mock(prisma.allowanceRecord.findMany).mockImplementation(async ({ where }: RecordArgs) => {
            if (where.itemId === 'large') return [record('L1', 'foremanA', '2026-09-01', 'foreman')];
            if (where.itemId === 'renov') return [record('R1', 'worker2', '2026-09-01', 'member', { amount: 100 })];
            return [];
        });

        const r = await get(`month=${MONTH}`);
        expect((r.body.items ?? []).map((i) => ({
            itemId: i.itemId,
            counts: [i.expectedCount, i.recordCount],
            missing: i.missing.map((m) => [m.key, m.payRole, m.amount]),
            extra: i.extra.map((x) => x.recordId),
            mismatch: i.mismatch.map((x) => x.recordId),
            people: i.people.map((p) => p.userId),
            sites: i.sites.map((x) => [x.projectMasterId, x.title, x.days]),
        }))).toEqual([
            {
                itemId: 'large', counts: [2, 1], missing: [['worker1|2026-09-01', 'member', 200]], extra: [], mismatch: [], people: ['foremanA', 'worker1'],
                sites: [['pm-tower', '駅前タワー 大規模修繕', 1]],
            },
            // 使っていない手当でも、対象として数えた現場は出る（「使う」にする前に、どの現場が対象になるかを確かめられる）
            {
                itemId: 'renov', counts: [2, 1], missing: [['foremanB|2026-09-01', 'foreman', 800]], extra: [], mismatch: [], people: ['foremanB', 'worker2'],
                sites: [['pm-改修', '改修の現場', 1]],
            },
        ]);
        expect(mock(prisma.allowanceRecord.findMany).mock.calls.map((c) => (c[0] as RecordArgs).where.itemId)).toEqual(['large', 'renov']);
        // 金額も、手当ごとに、その手当の分だけを読む（モックは3行とも返すが、ほかの手当の行は使わない）
        expect(mock(prisma.allowanceRate.findMany).mock.calls.map((c) => c[0] as unknown)).toEqual([rateArgs('large'), rateArgs('renov')]);
    });

    it('Cache-Control は no-store。GET は何も書かない', async () => {
        const r = await get(`month=${MONTH}`);
        expect(r.status).toBe(200);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        noWrites();
    });

    it("毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'。応答をためて使い回さない）", () => {
        expect(dynamic).toBe('force-dynamic');
    });

    it('DB を読むときに例外が起きたら 500（操作の名前は「手配との見比べの取得」）', async () => {
        mock(prisma.projectAssignment.findMany).mockRejectedValue(new Error('DB に届かない'));
        const r = await get(`month=${MONTH}`);
        // serverErrorResponse(操作の名前, 例外)。モックでは、操作の名前が error に入る
        expect([r.status, r.body.error]).toEqual([500, '手配との見比べの取得']);
    });
});

describe('GET: 1つの手当の中身（9月の例）', () => {
    it('missing = 付くはずなのに記録が無い人と日。区分は手配から（職長／手配確定のメンバー）、金額はその日付に有効な金額、isSelf は操作している人自身だけ', async () => {
        const item = await getItem();
        expect(item.missing).toEqual([
            // 9/1 職長A の班の作業員1（職長以外・9/1 からの金額）
            { key: 'worker1|2026-09-01', userId: 'worker1', userName: '作業員1', date: '2026-09-01', payRole: 'member', amount: 200, isSelf: false },
            // 9/3 職長B（その班の職長・9/1 からの金額）
            { key: 'foremanB|2026-09-03', userId: 'foremanB', userName: '職長B', date: '2026-09-03', payRole: 'foreman', amount: 1500, isSelf: false },
            // 9/10 職長B の班に入った管理者1（操作している人自身）・職長A（役職は職長だが、この日は職長以外）・職長B（9/10 からの金額）
            { key: 'admin1|2026-09-10', userId: 'admin1', userName: '管理者1', date: '2026-09-10', payRole: 'member', amount: 300, isSelf: true },
            { key: 'foremanA|2026-09-10', userId: 'foremanA', userName: '職長A', date: '2026-09-10', payRole: 'member', amount: 300, isSelf: false },
            { key: 'foremanB|2026-09-10', userId: 'foremanB', userName: '職長B', date: '2026-09-10', payRole: 'foreman', amount: 2000, isSelf: false },
        ]);
        expect(item.missing.map((m) => m.key)).toEqual(MISSING_KEYS);

        // 操作している人が変われば、isSelf も変わる（マネージャー1 は、この月の手配に入っていない）
        loginAs(MANAGER);
        expect((await getItem()).missing.map((m) => m.isSelf)).toEqual([false, false, false, false, false]);
    });

    it("extra = 記録はあるが、付くはずでない。reason は 'not_worked'（手配には入っているが出勤簿が出勤でない）と 'no_assignment'（手配に入っていない）", async () => {
        const item = await getItem();
        expect(item.extra).toEqual([
            // 作業員2 は 9/1 の班に入っているが、出勤簿が有給
            { recordId: 'r2', userId: 'worker2', userName: '作業員2', date: '2026-09-01', payRole: 'member', amount: 200, status: 'confirmed', createdByName: '職長A', reason: 'not_worked' },
            // 作業員3 は、9/5 の手配に入っていない
            { recordId: 'r6', userId: 'worker3', userName: '作業員3', date: '2026-09-05', payRole: 'member', amount: 200, status: 'confirmed', createdByName: '管理者1', reason: 'no_assignment' },
            // User の行が無い人の記録は、名前が「（不明）」
            { recordId: 'r7', userId: 'ghost', userName: '（不明）', date: '2026-09-10', payRole: 'member', amount: 300, status: 'confirmed', createdByName: '管理者1', reason: 'no_assignment' },
        ]);
    });

    it('mismatch = 記録はあるが、職長／職長以外が手配と違う。expectedPayRole は手配から見た区分', async () => {
        const item = await getItem();
        expect(item.mismatch).toEqual([
            // 9/2 職長A は自分の班の職長なのに、記録は職長以外
            { recordId: 'r3', userId: 'foremanA', userName: '職長A', date: '2026-09-02', payRole: 'member', amount: 200, status: 'confirmed', createdByName: '管理者1', expectedPayRole: 'foreman' },
            // 9/2 作業員1 は班のメンバーなのに、記録は職長
            { recordId: 'r4', userId: 'worker1', userName: '作業員1', date: '2026-09-02', payRole: 'foreman', amount: 1500, status: 'confirmed', createdByName: '管理者1', expectedPayRole: 'member' },
        ]);
    });

    it('unworked = 手配には入っているが、出勤簿が「働いた」（出勤・夜勤・休日出勤）でない日。出勤簿が無い日は attendanceStatus: null。記録の有無は問わない', async () => {
        const item = await getItem();
        expect(item.unworked).toEqual([
            { userId: 'worker2', userName: '作業員2', date: '2026-09-01', payRole: 'member', attendanceStatus: 'paid_leave' },   // 記録（r2）がある
            { userId: 'worker1', userName: '作業員1', date: '2026-09-10', payRole: 'member', attendanceStatus: null },           // 記録が無い
        ]);
        // 夜勤（9/2 職長A）・休日出勤（9/2 作業員1）は「働いた」なので、ここには出ない
        expect(item.unworked.map((u) => u.date)).not.toContain('2026-09-02');
    });

    it('people = 人ごとの「手配から数えた日数」と「記録の日数」（確認待ちの記録も数える）。User の行が無い人は「（不明）」', async () => {
        const item = await getItem();
        expect(item.people).toEqual([
            { userId: 'foremanB', userName: '職長B', expectedForemanDays: 2, expectedMemberDays: 0, recordedForemanDays: 0, recordedMemberDays: 0 },
            // 職長A: 手配では 職長 2日（9/1・9/2）＋ 職長以外 1日（9/10）。記録は 職長 1日（r1 確認待ち）＋ 職長以外 1日（r3）
            { userId: 'foremanA', userName: '職長A', expectedForemanDays: 2, expectedMemberDays: 1, recordedForemanDays: 1, recordedMemberDays: 1 },
            { userId: 'worker1', userName: '作業員1', expectedForemanDays: 0, expectedMemberDays: 2, recordedForemanDays: 1, recordedMemberDays: 0 },
            // 作業員2: 9/1 は有給なので、手配から数えるのは 9/3 の1日だけ。記録は2件
            { userId: 'worker2', userName: '作業員2', expectedForemanDays: 0, expectedMemberDays: 1, recordedForemanDays: 0, recordedMemberDays: 2 },
            { userId: 'admin1', userName: '管理者1', expectedForemanDays: 0, expectedMemberDays: 1, recordedForemanDays: 0, recordedMemberDays: 0 },
            { userId: 'worker3', userName: '作業員3', expectedForemanDays: 0, expectedMemberDays: 0, recordedForemanDays: 0, recordedMemberDays: 1 },
            { userId: 'ghost', userName: '（不明）', expectedForemanDays: 0, expectedMemberDays: 0, recordedForemanDays: 0, recordedMemberDays: 1 },
        ]);
    });

    it('sites = 対象として数えた現場（案件）の名前と、その現場に対象の手配があった日数。日数の多い順', async () => {
        const item = await getItem();
        expect(item.sites).toEqual([
            // 9/1・9/2（職長A の班）と 9/10（職長B の班）の3日
            { projectMasterId: 'pm-tower', title: '駅前タワー 大規模修繕', days: 3 },
            // 9/3 の1日
            { projectMasterId: 'pm-school', title: '第二小学校 外壁', days: 1 },
        ]);
    });

    it('expectedCount = 手配と出勤簿から付くはずの件数（人×日）／recordCount = その月の記録の件数（確認待ちも含む）', async () => {
        const item = await getItem();
        expect([item.expectedCount, item.recordCount]).toEqual([9, 7]);
        expect([item.itemId, item.itemName, item.isActive, item.constructionContent]).toEqual(['large', '大規模手当', true, '大規模']);
    });

    it("記録の区分・状態に知らない値が入っていたら、職長以外・確定として読む（'foreman' だけが職長・'pending' だけが確認待ち）", async () => {
        setWorld({
            assignments: [assignment('foremanA', '2026-09-01', ['worker1'])],
            attendance: present('2026-09-01', 'foremanA', 'worker1'),
            records: [
                // 作業員1 は手配では職長以外 → 職長以外として読むので、合っている
                record('n1', 'worker1', '2026-09-01', 'member', { payRole: 'MEMBER', status: 'PENDING' }),
                // 職長A は手配では職長 → 職長以外として読むので、区分が違う
                record('n2', 'foremanA', '2026-09-01', 'member', { payRole: 'FOREMAN', status: '' }),
            ],
        });
        const item = await getItem();
        expect(item.missing).toEqual([]);
        expect(item.extra).toEqual([]);
        expect(item.mismatch.map((x) => [x.recordId, x.payRole, x.status, x.expectedPayRole])).toEqual([['n2', 'member', 'confirmed', 'foreman']]);
        expect(item.people.map((p) => [p.userId, p.recordedForemanDays, p.recordedMemberDays])).toEqual([['foremanA', 0, 1], ['worker1', 0, 1]]);
    });
});

describe('GET: 手配の見方', () => {
    it('対象の工事内容の手配だけを見る（別の工事内容・未設定の現場の人は出てこない。旧い値 large_scale は「大規模」として拾う）', async () => {
        const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08'];
        setWorld({
            assignments: [
                assignment('foremanA', '2026-09-01', ['worker1']),                                 // 大規模
                assignment('foremanB', '2026-09-01', ['worker2', 'worker3'], '改修'),               // 別の工事内容
                assignment('foremanB', '2026-09-02', ['worker2'], 'large_scale', SCHOOL),          // 旧い値 → 大規模
                assignment('foremanA', '2026-09-03', ['worker1'], null),                           // 未設定
                assignment('foremanA', '2026-09-04', ['worker1'], ''),                             // 未設定（空文字）
                assignment('foremanA', '2026-09-07', ['worker1'], 'new_construction'),             // 旧い値 → 新築
                { ...assignment('foremanA', '2026-09-08', ['worker1']), projectMaster: null },     // 案件が読めない
            ],
            attendance: dates.flatMap((d) => present(d, 'foremanA', 'foremanB', 'worker1', 'worker2', 'worker3')),
        });

        const item = await getItem();
        expect(item.missing.map((m) => m.key)).toEqual(['foremanA|2026-09-01', 'worker1|2026-09-01', 'foremanB|2026-09-02', 'worker2|2026-09-02']);
        expect([item.expectedCount, item.unworked]).toEqual([4, []]);
        expect(item.people.map((p) => p.userId)).toEqual(['foremanB', 'foremanA', 'worker1', 'worker2']);
        // 対象として数えた現場も、「大規模」（旧い値 large_scale も）の案件だけ。1日ずつ
        expect(item.sites.map((x) => [x.projectMasterId, x.days]).sort()).toEqual([['pm-school', 1], ['pm-tower', 1]]);

        // ほかの現場にしか入っていない人（作業員3）は、人も出勤簿も読まない
        expect([...argsOf<UserArgs>(prisma.user.findMany).where.id.in].sort()).toEqual(['foremanA', 'foremanB', 'worker1', 'worker2']);
        expect([...argsOf<AttendanceArgs>(prisma.attendanceRecord.findMany).where.userId.in].sort()).toEqual(['foremanA', 'foremanB', 'worker1', 'worker2']);
    });

    it('手当の側の「対象の工事内容」も、同じ決まりでそろえてから比べる（旧い値 large_scale・前後の空白）', async () => {
        setWorld({
            assignments: [assignment('foremanA', '2026-09-01', ['worker1']), assignment('foremanB', '2026-09-01', ['worker2'], '改修')],
            attendance: present('2026-09-01', 'foremanA', 'worker1', 'foremanB', 'worker2'),
        });
        for (const constructionContent of ['large_scale', ' 大規模 ']) {
            answer(prisma.allowanceItem.findMany, [{ ...LARGE, constructionContent }]);
            const item = await getItem();
            expect([constructionContent, item.missing.map((m) => m.key)]).toEqual([constructionContent, ['foremanA|2026-09-01', 'worker1|2026-09-01']]);
        }
    });

    it('対象の工事内容が空の手当は、どの手配も拾わない（工事内容が未設定の現場と一致させない）', async () => {
        setWorld({
            assignments: [assignment('foremanA', '2026-09-01', ['worker1'], null), assignment('foremanA', '2026-09-02', ['worker1'], '')],
            attendance: [...present('2026-09-01', 'foremanA', 'worker1'), ...present('2026-09-02', 'foremanA', 'worker1')],
        });
        for (const constructionContent of ['', '   ']) {
            mock(prisma.user.findMany).mockClear();
            answer(prisma.allowanceItem.findMany, [{ ...LARGE, constructionContent }]);
            const item = await getItem();
            expect([item.expectedCount, item.missing, item.unworked, item.people, item.sites]).toEqual([0, [], [], [], []]);
            expect(prisma.user.findMany).not.toHaveBeenCalled();
        }
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });

    it('手当をもらえないロール（協力会社・協力会社のメンバー・User の行が無い人）は、missing にも unworked にも出ない。DB の大文字のロール（WORKER・MANAGER）は対象', async () => {
        // 協力会社が職長の班。作業員1（WORKER）・マネージャー1（MANAGER）・協力会社のメンバー1・User の行が無い人 は出勤、作業員2・協力会社のメンバー2 は出勤簿なし
        setWorld({
            assignments: [assignment('partnerBoss', '2026-09-01', ['worker1', 'worker2', 'partner1', 'partner2', 'manager1', 'ghost'])],
            attendance: present('2026-09-01', 'partnerBoss', 'worker1', 'partner1', 'manager1', 'ghost'),
        });
        const item = await getItem();
        expect(item.missing.map((m) => [m.key, m.payRole])).toEqual([['manager1|2026-09-01', 'member'], ['worker1|2026-09-01', 'member']]);
        expect(item.unworked.map((u) => [u.userId, u.attendanceStatus])).toEqual([['worker2', null]]);
        expect(item.expectedCount).toBe(2);
        expect(item.people.map((p) => p.userId)).toEqual(['worker1', 'manager1']);
    });

    it("extra の理由: 手配には入っているが、手当の対象外の人（今のロールが対象外・User の行が無い）の記録は 'not_eligible'。'not_worked'・'no_assignment' と見分ける", async () => {
        setWorld({
            // 9/1: 職長A の班（作業員1・作業員2・協力会社のメンバー1・協力会社のメンバー2・User の行が無い人）
            assignments: [assignment('foremanA', '2026-09-01', ['worker1', 'worker2', 'partner1', 'partner2', 'ghost'])],
            // 作業員2 は有給。協力会社のメンバー2 は出勤簿なし。ほかは出勤
            attendance: [...present('2026-09-01', 'foremanA', 'worker1', 'partner1', 'ghost'), attendance('worker2', '2026-09-01', 'paid_leave')],
            records: [
                record('e1', 'worker2', '2026-09-01', 'member'),       // 手配に入っている・対象のロール・出勤簿が有給
                record('e2', 'partner1', '2026-09-01', 'member'),      // 手配に入っている・協力会社のメンバー（出勤）
                record('e3', 'partner2', '2026-09-01', 'member'),      // 手配に入っている・協力会社のメンバー（出勤簿なし）
                record('e4', 'ghost', '2026-09-01', 'member'),         // 手配に入っている・User の行が無い
                record('e5', 'partnerBoss', '2026-09-01', 'member'),   // 協力会社で、手配にも入っていない
                record('e6', 'worker3', '2026-09-01', 'member'),       // 対象のロールだが、手配に入っていない
                record('e7', 'partner1', '2026-09-02', 'member'),      // 9/2 は、手配が無い
            ],
        });
        const item = await getItem();
        expect(item.extra.map((x) => [x.recordId, x.userName, x.reason])).toEqual([
            ['e1', '作業員2', 'not_worked'],
            // 対象外の人は、出勤簿が出勤でも・無くても not_eligible（not_worked にはしない）
            ['e2', '協力会社のメンバー1', 'not_eligible'],
            ['e3', '協力会社のメンバー2', 'not_eligible'],
            ['e4', '（不明）', 'not_eligible'],
            // 手配に入っていなければ、対象外の人でも no_assignment
            ['e5', '協力会社', 'no_assignment'],
            ['e6', '作業員3', 'no_assignment'],
            ['e7', '協力会社のメンバー1', 'no_assignment'],
        ]);
        expect(item.mismatch).toEqual([]);
        // 対象外の人は、missing にも unworked にも出ない
        expect(item.missing.map((m) => m.key)).toEqual(['foremanA|2026-09-01', 'worker1|2026-09-01']);
        expect(item.unworked.map((u) => [u.userId, u.attendanceStatus])).toEqual([['worker2', 'paid_leave']]);
    });

    it('同じ日に、対象の現場に2件入っていても1日。役職が職長の人が、ほかの人の班に入った日は職長以外（同じ日に自分の班も対象の現場なら職長。自分の班が対象でない現場なら職長以外）', async () => {
        setWorld({
            assignments: [
                // 9/1: 職長A の班（作業員1）が、対象の現場を2つ回った（駅前タワーと第二小学校）
                assignment('foremanA', '2026-09-01', ['worker1']),
                assignment('foremanA', '2026-09-01', ['worker1'], '大規模', SCHOOL),
                // 9/2: 職長B（役職は職長）が、職長A の班に入った
                assignment('foremanA', '2026-09-02', ['foremanB']),
                // 9/3: 職長B は、職長A の班にも入り、自分の班でも対象の現場に入った
                assignment('foremanA', '2026-09-03', ['foremanB']),
                assignment('foremanB', '2026-09-03', []),
                // 9/4: 手配確定のメンバーの中に、職長A 本人も入っている（空の ID・文字でない ID は捨てる）
                assignment('foremanA', '2026-09-04', ['foremanA', '', null, 5, 'worker1']),
                // 9/7: 職長B は、職長A の班（対象の現場）に入り、自分の班は「改修」の現場（対象でない）
                assignment('foremanA', '2026-09-07', ['foremanB']),
                assignment('foremanB', '2026-09-07', [], '改修'),
            ],
            attendance: [
                ...present('2026-09-01', 'foremanA', 'worker1'),
                ...present('2026-09-02', 'foremanA', 'foremanB'),
                ...present('2026-09-03', 'foremanA', 'foremanB'),
                ...present('2026-09-04', 'foremanA', 'worker1'),
                ...present('2026-09-07', 'foremanA', 'foremanB'),
            ],
        });
        const item = await getItem();
        // 区分は、その日の「対象の現場」の手配の全部から決まる（職長とメンバーの両方に出る人は職長）
        expect(item.missing.map((m) => `${m.date} ${m.userId}:${m.payRole}`)).toEqual([
            '2026-09-01 foremanA:foreman', '2026-09-01 worker1:member',
            '2026-09-02 foremanA:foreman', '2026-09-02 foremanB:member',
            '2026-09-03 foremanA:foreman', '2026-09-03 foremanB:foreman',
            '2026-09-04 foremanA:foreman', '2026-09-04 worker1:member',
            '2026-09-07 foremanA:foreman', '2026-09-07 foremanB:member',
        ]);
        expect(item.expectedCount).toBe(10);
        expect(item.people).toEqual([
            { userId: 'foremanB', userName: '職長B', expectedForemanDays: 1, expectedMemberDays: 2, recordedForemanDays: 0, recordedMemberDays: 0 },
            { userId: 'foremanA', userName: '職長A', expectedForemanDays: 5, expectedMemberDays: 0, recordedForemanDays: 0, recordedMemberDays: 0 },
            { userId: 'worker1', userName: '作業員1', expectedForemanDays: 0, expectedMemberDays: 2, recordedForemanDays: 0, recordedMemberDays: 0 },
        ]);
        // 空の ID・文字でない ID は、人・出勤簿を引くときの ID にも入れない
        expect([...argsOf<UserArgs>(prisma.user.findMany).where.id.in].sort()).toEqual(['foremanA', 'foremanB', 'worker1']);
        expect([...argsOf<AttendanceArgs>(prisma.attendanceRecord.findMany).where.userId.in].sort()).toEqual(['foremanA', 'foremanB', 'worker1']);
    });

    it('手配確定のメンバーが「配列でない JSON」で入っている手配は、職長だけを見る（500 にしない。GET も POST も）', async () => {
        const cases: [string, string][] = [
            ['null', 'null'],
            ['空のオブジェクト', '{}'],
            ['オブジェクト', '{"0":"worker1"}'],
            ['数', '5'],
            ['文字列', '"worker1"'],
            ['真偽値', 'true'],
        ];
        for (const [label, confirmedWorkerIds] of cases) {
            mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
            // 9/1: 職長A の班。手配確定のメンバーの列が壊れている。職長A も作業員1 も出勤
            setWorld({
                assignments: [{ ...assignment('foremanA', '2026-09-01', null), confirmedWorkerIds }],
                attendance: present('2026-09-01', 'foremanA', 'worker1'),
            });

            const got = await get(`month=${MONTH}`);
            expect([label, got.status, got.body.items?.[0]?.missing.map((m) => [m.key, m.payRole]), got.body.items?.[0]?.unworked])
                .toEqual([label, 200, [['foremanA|2026-09-01', 'foreman']], []]);

            const posted = await post({ keys: ['foremanA|2026-09-01', 'worker1|2026-09-01'] });
            expect([label, posted.status, posted.body]).toEqual([label, 200, { added: 1, pending: 0, skipped: 1 }]);
            expect(insertArgs().data).toEqual([newRow('foremanA', '2026-09-01', 'foreman', 1500, 'rate1', 'confirmed')]);
        }
    });

    it('missing・unworked の並びは、日付の古い順 → 人の ID 順（DB が返す手配の順・手配確定のメンバーの順によらない）', async () => {
        setWorld({
            // DB は、手配を日付の新しい順で返した。メンバーも ID の逆順で入っている
            assignments: [
                assignment('foremanB', '2026-09-02', ['worker3', 'worker2', 'worker1']),
                assignment('foremanA', '2026-09-01', ['worker3', 'worker2', 'worker1']),
            ],
            // 職長と作業員3 は出勤（→ missing）。作業員1・作業員2 は出勤簿なし（→ unworked）
            attendance: [...present('2026-09-02', 'worker3', 'foremanB'), ...present('2026-09-01', 'worker3', 'foremanA')],
        });
        const item = await getItem();
        expect(item.missing.map((m) => m.key)).toEqual(['foremanA|2026-09-01', 'worker3|2026-09-01', 'foremanB|2026-09-02', 'worker3|2026-09-02']);
        expect(item.unworked.map((u) => `${u.userId}|${u.date}`)).toEqual(['worker1|2026-09-01', 'worker2|2026-09-01', 'worker1|2026-09-02', 'worker2|2026-09-02']);
    });

    it('先の日付（日本時間の今日より後）の手配は見ない。今日の分は見る', async () => {
        // 9/15・9/16・9/17 に、職長A の班（作業員1）が対象の現場（駅前タワー）。職長A は出勤、作業員1 は出勤簿なし。
        // 9/17 には、職長B の班が、別の対象の現場（第二小学校）にも入る
        const dates = ['2026-09-15', '2026-09-16', '2026-09-17'];
        setWorld({
            assignments: [...dates.map((d) => assignment('foremanA', d, ['worker1'])), assignment('foremanB', '2026-09-17', null, '大規模', SCHOOL)],
            attendance: dates.flatMap((d) => present(d, 'foremanA')),
        });

        freezeNow('2026-09-15T15:30:00.000Z'); // 日本時間 9/16 0:30（UTC ではまだ 9/15）
        const justAfterMidnight = await getItem();
        expect(justAfterMidnight.missing.map((m) => m.key)).toEqual(['foremanA|2026-09-15', 'foremanA|2026-09-16']);
        expect(justAfterMidnight.unworked.map((u) => `${u.userId}|${u.date}`)).toEqual(['worker1|2026-09-15', 'worker1|2026-09-16']);
        expect(justAfterMidnight.expectedCount).toBe(2);
        // 対象として数えた現場の日数にも、先の日付は入れない（9/17 だけの第二小学校は出ない）
        expect(justAfterMidnight.sites).toEqual([{ projectMasterId: 'pm-tower', title: '駅前タワー 大規模修繕', days: 2 }]);

        freezeNow('2026-09-15T14:59:00.000Z'); // 日本時間 9/15 23:59
        const justBeforeMidnight = await getItem();
        expect(justBeforeMidnight.missing.map((m) => m.key)).toEqual(['foremanA|2026-09-15']);
        expect(justBeforeMidnight.unworked.map((u) => `${u.userId}|${u.date}`)).toEqual(['worker1|2026-09-15']);
        expect(justBeforeMidnight.expectedCount).toBe(1);
        expect(justBeforeMidnight.sites).toEqual([{ projectMasterId: 'pm-tower', title: '駅前タワー 大規模修繕', days: 1 }]);
    });

    it('人の並び: dispatchSortOrder の小さい順（0 がいちばん前）→ null は最後 → 名前の日本語順 → 人の ID 順', async () => {
        answer(prisma.user.findMany, [
            { id: 'u-i', displayName: 'いとう', role: 'WORKER', dispatchSortOrder: null },
            { id: 'u-u', displayName: 'うえだ', role: 'WORKER', dispatchSortOrder: 2 },
            { id: 'u-a', displayName: 'アベ', role: 'WORKER', dispatchSortOrder: null },   // カタカナ。文字コードの順だと「いとう」の後ろになる
            { id: 'u-e', displayName: 'えのもと', role: 'WORKER', dispatchSortOrder: 1 },
            { id: 'u-o', displayName: 'おおた', role: 'WORKER', dispatchSortOrder: 0 },
            // 並び順も名前も同じ2人（違うのは ID だけ）。最後の決め手は ID の順
            { id: 'u-k2', displayName: 'かとう', role: 'WORKER', dispatchSortOrder: 3 },
            { id: 'u-k1', displayName: 'かとう', role: 'WORKER', dispatchSortOrder: 3 },
        ]);
        // 記録は u-k2 が先（読んだ順のままなら、u-k2 → u-k1 になってしまう）
        setWorld({ records: ['u-i', 'u-k2', 'u-u', 'u-a', 'u-e', 'u-k1', 'u-o'].map((userId, i) => record(`p${i}`, userId, '2026-09-01', 'member')) });
        const item = await getItem();
        expect(item.people.map((p) => `${p.userName}(${p.userId})`)).toEqual([
            'おおた(u-o)', 'えのもと(u-e)', 'うえだ(u-u)', 'かとう(u-k1)', 'かとう(u-k2)', 'アベ(u-a)', 'いとう(u-i)',
        ]);

        // 読んだ順が逆（u-k1 が先）でも、同じ並びになる
        setWorld({ records: ['u-k1', 'u-k2'].map((userId, i) => record(`q${i}`, userId, '2026-09-01', 'member')) });
        expect((await getItem()).people.map((p) => p.userId)).toEqual(['u-k1', 'u-k2']);
    });
});

describe('GET: 対象として数えた現場（sites）', () => {
    it('同じ日に2つの班が同じ案件に入っても1日。出勤簿が無い日・手当をもらえる人がいない班でも、対象の手配があれば数える。対象でない工事内容の案件は出ない', async () => {
        const BRIDGE: Site = { id: 'pm-bridge', title: '陸橋 補修' };
        setWorld({
            assignments: [
                // 駅前タワー: 9/1 は、職長A の班と職長B の班の両方が入った。9/2 は職長A の班だけ → 2日
                assignment('foremanA', '2026-09-01', ['worker1'], '大規模', TOWER),
                assignment('foremanB', '2026-09-01', ['worker2'], '大規模', TOWER),
                assignment('foremanA', '2026-09-02', ['worker1'], '大規模', TOWER),
                // 第二小学校: 9/3 に、協力会社の班（手当をもらえる人がいない・出勤簿も無い）→ それでも1日
                assignment('partnerBoss', '2026-09-03', ['partner1'], '大規模', SCHOOL),
                // 陸橋: 工事内容が「改修」→ 出ない
                assignment('foremanB', '2026-09-04', ['worker2'], '改修', BRIDGE),
            ],
            // 出勤簿は 9/1 だけ
            attendance: present('2026-09-01', 'foremanA', 'worker1', 'foremanB', 'worker2'),
        });
        const item = await getItem();
        expect(item.sites).toEqual([
            { projectMasterId: 'pm-tower', title: '駅前タワー 大規模修繕', days: 2 },
            { projectMasterId: 'pm-school', title: '第二小学校 外壁', days: 1 },
        ]);
        // 付くはずの件数は、9/1 の4人だけ（現場の日数とは別に数える）
        expect(item.expectedCount).toBe(4);
    });

    it('同じ日に、1つの班が対象の案件を2つ回ったら、案件ごとに1日ずつ数える（人は、その日は1日）', async () => {
        setWorld({
            assignments: [
                // 9/1: 職長A の班（作業員1）が、駅前タワーと第二小学校の両方に入った
                assignment('foremanA', '2026-09-01', ['worker1'], '大規模', TOWER),
                assignment('foremanA', '2026-09-01', ['worker1'], '大規模', SCHOOL),
                // 9/2: 駅前タワーだけ
                assignment('foremanA', '2026-09-02', ['worker1'], '大規模', TOWER),
            ],
            attendance: [...present('2026-09-01', 'foremanA', 'worker1'), ...present('2026-09-02', 'foremanA', 'worker1')],
        });
        const item = await getItem();
        expect(item.sites).toEqual([
            { projectMasterId: 'pm-tower', title: '駅前タワー 大規模修繕', days: 2 },
            { projectMasterId: 'pm-school', title: '第二小学校 外壁', days: 1 },
        ]);
        // 人は、同じ日に2件入っていても1日（2人 × 2日 ＝ 4件）
        expect(item.expectedCount).toBe(4);
        expect(item.missing.map((m) => m.key)).toEqual(['foremanA|2026-09-01', 'worker1|2026-09-01', 'foremanA|2026-09-02', 'worker1|2026-09-02']);
    });

    it('並びは、日数の多い順 → 案件の名前順 → 案件の ID 順（DB が返す手配の順によらない）', async () => {
        const UMEDA: Site = { id: 'pm-2', title: 'うめだ駅前ビル' };     // 2日
        const ASAHI: Site = { id: 'pm-9', title: 'あさひ団地' };         // 1日
        const IZUMI: Site = { id: 'pm-8', title: 'いずみ団地' };         // 1日（ID は あさひ団地 より小さい）
        const EBISU_B: Site = { id: 'pm-1b', title: 'えびす寮' };        // 1日（同じ名前の案件が2つ）
        const EBISU_A: Site = { id: 'pm-1a', title: 'えびす寮' };        // 1日
        setWorld({
            assignments: [
                assignment('foremanA', '2026-09-05', null, '大規模', EBISU_B),
                assignment('foremanA', '2026-09-04', null, '大規模', IZUMI),
                assignment('foremanA', '2026-09-03', null, '大規模', ASAHI),
                assignment('foremanA', '2026-09-02', null, '大規模', UMEDA),
                assignment('foremanA', '2026-09-01', null, '大規模', UMEDA),
                assignment('foremanA', '2026-09-07', null, '大規模', EBISU_A),
            ],
        });
        const item = await getItem();
        expect(item.sites).toEqual([
            { projectMasterId: 'pm-2', title: 'うめだ駅前ビル', days: 2 },
            { projectMasterId: 'pm-9', title: 'あさひ団地', days: 1 },
            { projectMasterId: 'pm-8', title: 'いずみ団地', days: 1 },
            { projectMasterId: 'pm-1a', title: 'えびす寮', days: 1 },
            { projectMasterId: 'pm-1b', title: 'えびす寮', days: 1 },
        ]);
    });

    it('対象の手配が無い月は []（記録だけがある月も）', async () => {
        setWorld({ records: [record('only', 'worker1', '2026-09-01', 'member')] });
        const item = await getItem();
        expect([item.sites, item.recordCount, item.extra.map((x) => [x.recordId, x.reason])]).toEqual([[], 1, [['only', 'no_assignment']]]);
    });
});

describe('GET: 手当の始まりの日（いちばん古い適用開始日）より前の日には付けられない', () => {
    it('手当が始まる前の日（その日付に有効な金額が無い日）の手配は見ない。始まりの日からの分だけを見る（月の途中に始まりの日がある例）', async () => {
        // 金額は 9/10 からの1行だけ ＝ 始まりの日は 9/10
        answer(prisma.allowanceRate.findMany, RATES_FROM_10TH);
        setWorld({
            assignments: [
                assignment('foremanB', '2026-09-08', ['worker2'], '大規模', SCHOOL),   // 始まる前（職長B・作業員2・第二小学校は、この日だけ）
                assignment('foremanA', '2026-09-09', ['worker1']),   // 始まる前の、最後の日
                assignment('foremanA', '2026-09-10', ['worker1']),   // 始まりの日
                assignment('foremanA', '2026-09-11', ['worker1']),
            ],
            // 職長は毎日出勤（見ていれば missing）。作業員は、9/11 の作業員1 だけが出勤で、ほかの日は出勤簿なし（見ていれば unworked）
            attendance: [
                ...present('2026-09-08', 'foremanB'),
                ...present('2026-09-09', 'foremanA'),
                ...present('2026-09-10', 'foremanA'),
                ...present('2026-09-11', 'foremanA', 'worker1'),
            ],
        });

        const item = await getItem();
        // 9/8・9/9 の分は、missing にも unworked にも、人ごとの「手配から数えた日数」にも入らない
        expect(item.missing.map((m) => [m.key, m.payRole, m.amount])).toEqual([
            ['foremanA|2026-09-10', 'foreman', 2000],
            ['foremanA|2026-09-11', 'foreman', 2000],
            ['worker1|2026-09-11', 'member', 300],
        ]);
        expect(item.unworked.map((u) => `${u.userId}|${u.date}`)).toEqual(['worker1|2026-09-10']);
        expect(item.expectedCount).toBe(3);
        expect(item.people).toEqual([
            { userId: 'foremanA', userName: '職長A', expectedForemanDays: 2, expectedMemberDays: 0, recordedForemanDays: 0, recordedMemberDays: 0 },
            { userId: 'worker1', userName: '作業員1', expectedForemanDays: 0, expectedMemberDays: 1, recordedForemanDays: 0, recordedMemberDays: 0 },
        ]);
        // 始まる前の日にしか入っていない人（職長B・作業員2）は、人も出勤簿も読まない（先の日付の手配と同じ扱い）
        expect([...argsOf<UserArgs>(prisma.user.findMany).where.id.in].sort()).toEqual(['foremanA', 'worker1']);
        expect([...argsOf<AttendanceArgs>(prisma.attendanceRecord.findMany).where.userId.in].sort()).toEqual(['foremanA', 'worker1']);
        // 対象として数えた現場の日数にも、始まる前の日は入れない（駅前タワーは 9/10・9/11 の2日。9/8 だけの第二小学校は出ない）
        expect(item.sites).toEqual([{ projectMasterId: 'pm-tower', title: '駅前タワー 大規模修繕', days: 2 }]);
    });

    it('金額の行が1つも無い手当は、どの手配も見ない（missing・unworked は空。人も出勤簿も読まない）', async () => {
        answer(prisma.allowanceRate.findMany, []);
        // 手配と出勤簿は、9月の例のまま（金額があれば、付くはずの日が9件ある）。記録は無し
        setWorld({ assignments: EXAMPLE.assignments, attendance: EXAMPLE.attendance });

        const item = await getItem();
        expect([item.expectedCount, item.missing, item.unworked, item.people, item.sites]).toEqual([0, [], [], [], []]);
        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });

    it('9月の例で、始まりの日が 9/10 なら、付くはずの日は 9/10 の3件だけ。missing の amount は必ず数（「金額なし」の行は出ない）', async () => {
        answer(prisma.allowanceRate.findMany, RATES_FROM_10TH);
        const item = await getItem();
        expect(item.missing).toEqual([
            { key: 'admin1|2026-09-10', userId: 'admin1', userName: '管理者1', date: '2026-09-10', payRole: 'member', amount: 300, isSelf: true },
            { key: 'foremanA|2026-09-10', userId: 'foremanA', userName: '職長A', date: '2026-09-10', payRole: 'member', amount: 300, isSelf: false },
            { key: 'foremanB|2026-09-10', userId: 'foremanB', userName: '職長B', date: '2026-09-10', payRole: 'foreman', amount: 2000, isSelf: false },
        ]);
        expect(item.expectedCount).toBe(3);
        // 9/1〜9/3 の手配は見ないので、作業員2 の 9/1（有給）は unworked に出ない
        expect(item.unworked.map((u) => `${u.userId}|${u.date}`)).toEqual(['worker1|2026-09-10']);
        // 人ごとの「手配から数えた日数」も、9/10 の分だけ（記録の日数は、記録のまま）
        expect(item.people.map((p) => [p.userId, p.expectedForemanDays, p.expectedMemberDays])).toEqual([
            ['foremanB', 1, 0], ['foremanA', 0, 1], ['worker1', 0, 0], ['worker2', 0, 0], ['admin1', 0, 1], ['worker3', 0, 0], ['ghost', 0, 0],
        ]);
        // 対象として数えた現場も、9/10 の駅前タワーだけ
        expect(item.sites).toEqual([{ projectMasterId: 'pm-tower', title: '駅前タワー 大規模修繕', days: 1 }]);
    });
});

describe('GET: DB の読み方（モックは where・select を見ないので、渡した引数で確かめる）', () => {
    it('金額は、見比べの中で、その手当の分だけを1回読む（route では、別に読まない）', async () => {
        expect((await get(`month=${MONTH}`)).status).toBe(200);
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceRate.findMany)).toEqual(rateArgs('large'));
    });

    it('手配は「日本時間のその月」・isBackfilled: false で引く。記録と出勤簿は「月の1日 〜 翌月1日より前」（UTC 0時の印）で引く', async () => {
        expect((await get(`month=${MONTH}`)).status).toBe(200);

        expect(prisma.projectAssignment.findMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.projectAssignment.findMany)).toEqual({
            // 9/1 の手配は UTC 8/31 15:00、10/1 の手配は UTC 9/30 15:00
            where: { date: { gte: new Date('2026-08-31T15:00:00.000Z'), lt: new Date('2026-09-30T15:00:00.000Z') }, isBackfilled: false },
            // 案件の ID と名前は、対象として数えた現場（sites）を出すのに使う
            select: ASSIGNMENT_SELECT,
        });

        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceRecord.findMany)).toEqual({
            where: { itemId: 'large', date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') } },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, userId: true, date: true, payRole: true, amount: true, status: true, createdByName: true },
        });

        expect(prisma.attendanceRecord.findMany).toHaveBeenCalledTimes(1);
        const attendanceArgs = argsOf<AttendanceArgs>(prisma.attendanceRecord.findMany);
        expect(attendanceArgs.where.date).toEqual({ gte: utc0('2026-09-01'), lt: utc0('2026-10-01') });
        expect(attendanceArgs.select).toEqual({ userId: true, date: true, status: true });
    });

    it('12月（年をまたぐ月）: 手配は UTC 11/30 15:00 〜 12/31 15:00、記録と出勤簿は 12/1 〜 翌年 1/1', async () => {
        expect((await get('month=2025-12')).status).toBe(200);
        expect(argsOf<{ where: unknown }>(prisma.projectAssignment.findMany).where).toEqual({
            date: { gte: new Date('2025-11-30T15:00:00.000Z'), lt: new Date('2025-12-31T15:00:00.000Z') },
            isBackfilled: false,
        });
        expect(argsOf<RecordArgs>(prisma.allowanceRecord.findMany).where).toEqual({ itemId: 'large', date: { gte: utc0('2025-12-01'), lt: utc0('2026-01-01') } });
        expect(argsOf<AttendanceArgs>(prisma.attendanceRecord.findMany).where.date).toEqual({ gte: utc0('2025-12-01'), lt: utc0('2026-01-01') });
    });

    it('人は「手配に出てくる人 ＋ 記録のある人」を、在籍かどうかで絞らずに引く。出勤簿は「手配に出てくる人」だけを引く', async () => {
        expect((await get(`month=${MONTH}`)).status).toBe(200);

        expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        const userArgs = argsOf<UserArgs>(prisma.user.findMany);
        expect({ ...userArgs, where: { ...userArgs.where, id: { in: [...userArgs.where.id.in].sort() } } }).toEqual({
            // 作業員3・ghost は記録だけの人。where は id だけ（isActive が無い＝辞めた人の、在籍中の月も数える）
            where: { id: { in: ['admin1', 'foremanA', 'foremanB', 'ghost', 'partner1', 'worker1', 'worker2', 'worker3'] } },
            select: { id: true, displayName: true, role: true, dispatchSortOrder: true },
        });

        const attendanceArgs = argsOf<AttendanceArgs>(prisma.attendanceRecord.findMany);
        expect([...attendanceArgs.where.userId.in].sort()).toEqual(['admin1', 'foremanA', 'foremanB', 'partner1', 'worker1', 'worker2']);
    });
});

// ================================================================ POST

describe('POST: 入力の形（合わなければ、その時点で断る。何も読まない・書かない）', () => {
    it('入力の形が違う → 400「入力が不正です」（JSON として読めない body も 400。500 にしない）', async () => {
        const tooMany = Array.from({ length: 2001 }, (_, i) => `worker${i}|2026-09-01`);
        const cases: [string, Record<string, unknown>][] = [
            ['itemId が空', { itemId: '' }],
            ['itemId が数字', { itemId: 1 }],
            ['itemId が無い', { itemId: undefined }],
            ['itemId が null', { itemId: null }],
            ['month が数字', { month: 202609 }],
            ['month が無い', { month: undefined }],
            ['month が null', { month: null }],
            ['keys が文字列', { keys: 'worker1|2026-09-01' }],
            ['keys が無い', { keys: undefined }],
            ['keys が null', { keys: null }],
            ['keys がオブジェクト', { keys: { 0: 'worker1|2026-09-01' } }],
            ['keys が空の配列', { keys: [] }],
            ['keys が 2001件', { keys: tooMany }],
            ['keys に空文字', { keys: ['worker1|2026-09-01', ''] }],
            ['keys に数字', { keys: ['worker1|2026-09-01', 1] }],
            ['keys に null', { keys: [null] }],
        ];
        for (const [label, over] of cases) {
            const r = await post(over);
            // 形のまちがいは validationErrorResponse。モックでは、文言が error ではなく details に入る
            expect([label, r.status, r.body.error, r.body.details]).toEqual([label, 400, 'Validation Error', '入力が不正です']);
        }
        for (const raw of ['これは JSON ではない', '"文字列"', 'null', '[]', '5', '']) {
            const r = await postRaw(raw);
            expect([raw, r.status, r.body.details]).toEqual([raw, 400, '入力が不正です']);
        }
        noReads();
        noWrites();
    });

    it('month の形が違う → 400「月が不正です」（年は 2000〜2999 だけ）', async () => {
        for (const month of ['2026-13', '2026-00', '2026-9', '202609', '2026/09', '2026-09-01', ' 2026-09', '', '0026-09', '1999-12', '3000-01']) {
            const r = await post({ month });
            expect([month, r.status, r.body.error, r.body.details]).toEqual([month, 400, 'Validation Error', '月が不正です']);
        }
        noReads();
        noWrites();
    });

    it('keys は 2000件まで受け付ける（付くはずの一覧に無い key ばかりなら、何も入れずに 200）', async () => {
        const keys = Array.from({ length: 2000 }, (_, i) => `nobody${i}|2026-09-01`);
        const r = await post({ keys });
        expect([r.status, r.body]).toEqual([200, { added: 0, pending: 0, skipped: 2000 }]);
        noWrites();
    });
});

describe('POST: 付ける前の確かめ（どれも何も書かない）', () => {
    it('手当が無い → 404「手当が見つかりません」', async () => {
        answer(prisma.allowanceItem.findUnique, null);
        const r = await post({ itemId: 'no-such-item' });
        expect([r.status, r.body.error]).toEqual([404, '手当が見つかりません']);
        expect(prisma.allowanceItem.findUnique).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceItem.findUnique)).toEqual({
            where: { id: 'no-such-item' },
            select: { id: true, name: true, isActive: true, constructionContent: true },
        });
        noCrosscheckReads();
        noWrites();
    });

    it('使っていない手当 → 400「この手当は「使わない」になっています（管理者が、設定の「手当」で「使う」にすると、付けられます）」（GET の一覧には出るが、付けられない）', async () => {
        answer(prisma.allowanceItem.findUnique, { ...LARGE, isActive: false });
        const r = await post();
        expect([r.status, r.body.error]).toEqual([400, 'この手当は「使わない」になっています（管理者が、設定の「手当」で「使う」にすると、付けられます）']);
        noCrosscheckReads();
        noWrites();
    });

    it('締めた月 → 400「この月は締めてあります（管理者が締めを外すと、変えられます）」（手配を読む前・トランザクションを開く前に断る）', async () => {
        answer(prisma.allowanceMonthClose.findMany, [{ month: MONTH }]);
        const r = await post();
        expect([r.status, r.body.error]).toEqual([400, 'この月は締めてあります（管理者が締めを外すと、変えられます）']);
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceMonthClose.findMany)).toEqual({ where: { month: { in: [MONTH] } }, select: { month: true } });
        noCrosscheckReads();
        noWrites();
    });
});

describe('POST: まとめて付ける', () => {
    it("付くはずなのに記録が無い分を全部送ると、全部入る（source は 'bulk'・foremanId は null・skipDuplicates: true）", async () => {
        const r = await post();
        expect([r.status, r.body]).toEqual([200, { added: 5, pending: 1, skipped: 0 }]);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');

        expect(insertArgs()).toEqual({
            data: [
                // 区分は手配から（職長B はその班の職長。職長A は役職が職長でも、9/10 は職長B の班なので職長以外）
                // 金額は、日付ごとに有効な金額（9/1〜 は 1,500円・200円、9/10〜 は 2,000円・300円）
                // 状態は、操作している人（管理者1）自身の分だけ確認待ち
                newRow('worker1', '2026-09-01', 'member', 200, 'rate1', 'confirmed'),
                newRow('foremanB', '2026-09-03', 'foreman', 1500, 'rate1', 'confirmed'),
                newRow('admin1', '2026-09-10', 'member', 300, 'rate2', 'pending'),
                newRow('foremanA', '2026-09-10', 'member', 300, 'rate2', 'confirmed'),
                newRow('foremanB', '2026-09-10', 'foreman', 2000, 'rate2', 'confirmed'),
            ],
            skipDuplicates: true,
        });
    });

    it('見比べ直すのは、送られた手当・月（手配は日本時間のその月、記録はその手当・その月で引く）', async () => {
        expect((await post()).status).toBe(200);
        expect(argsOf<{ where: unknown }>(prisma.projectAssignment.findMany).where).toEqual({
            date: { gte: new Date('2026-08-31T15:00:00.000Z'), lt: new Date('2026-09-30T15:00:00.000Z') },
            isBackfilled: false,
        });
        expect(argsOf<RecordArgs>(prisma.allowanceRecord.findMany).where).toEqual({ itemId: 'large', date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') } });
    });

    it('付けるのは、サーバーが作り直した missing にある key だけ。無い key は入れずに、skipped に数える（同じ key の重なりは1つと数える）', async () => {
        const notMissing = [
            'foremanA|2026-09-01',          // もう付いている（確認待ち）
            'worker2|2026-09-03',           // もう付いている
            'foremanA|2026-09-02',          // 区分の違う記録が付いている（付け直さない）
            'worker1|2026-09-10',           // 手配には入っているが、出勤簿が無い
            'worker2|2026-09-01',           // 手配には入っているが、出勤簿が有給
            'partner1|2026-09-01',          // 手当をもらえないロール
            'worker3|2026-09-01',           // その日の手配に入っていない人
            'worker1|2026-09-05',           // 手配が無い日
            'worker1|2026-08-31',           // 別の月の日付
            'worker1|2026-10-01',           // 別の月の日付
            'worker1|2026-09-01|foreman',   // 区分を足した key
            'でたらめ', 'worker1', '2026-09-01', '|2026-09-01', 'worker1|', ' worker1|2026-09-01', 'WORKER1|2026-09-01',
        ];
        const r = await post({ keys: [...notMissing, 'worker1|2026-09-01', ...notMissing, 'worker1|2026-09-01'] });
        expect([r.status, r.body]).toEqual([200, { added: 1, pending: 0, skipped: notMissing.length }]);
        expect(insertArgs().data).toEqual([newRow('worker1', '2026-09-01', 'member', 200, 'rate1', 'confirmed')]);
    });

    it('区分（職長／職長以外）・金額・状態は、画面から送っても使わない（手配と金額の表から、サーバーが決める）', async () => {
        const r = await post({
            keys: ['admin1|2026-09-10', 'foremanA|2026-09-10'],
            // ↓ どれも読まない
            payRole: 'foreman',
            amount: 99999,
            status: 'confirmed',
            entries: [{ userId: 'foremanA', dateKey: '2026-09-10', date: '2026-09-10', payRole: 'foreman', amount: 99999, status: 'confirmed' }],
        });
        expect([r.status, r.body]).toEqual([200, { added: 2, pending: 1, skipped: 0 }]);
        expect(insertArgs().data).toEqual([
            newRow('admin1', '2026-09-10', 'member', 300, 'rate2', 'pending'),
            newRow('foremanA', '2026-09-10', 'member', 300, 'rate2', 'confirmed'),
        ]);
    });

    it('1か月ぶん（100人 × 20日 ＝ 2000件）を、1回で付けられる', async () => {
        // 9/1〜9/20 の毎日、職長A の班（作業員 99人）が対象の現場に入り、全員が出勤。記録は無い
        const workerIds = Array.from({ length: 99 }, (_, i) => `w${String(i).padStart(2, '0')}`);
        const dates = Array.from({ length: 20 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
        answer(prisma.user.findMany, [
            { id: 'foremanA', displayName: '職長A', role: 'FOREMAN2', dispatchSortOrder: 1 },
            ...workerIds.map((id) => ({ id, displayName: `作業員${id}`, role: 'WORKER', dispatchSortOrder: null })),
        ]);
        setWorld({
            assignments: dates.map((d) => assignment('foremanA', d, workerIds)),
            attendance: dates.flatMap((d) => present(d, 'foremanA', ...workerIds)),
        });
        const keys = (await getItem()).missing.map((m) => m.key);
        expect(keys).toHaveLength(2000);

        const r = await post({ keys });
        expect([r.status, r.body]).toEqual([200, { added: 2000, pending: 0, skipped: 0 }]);
        const { data } = insertArgs();
        expect(data).toHaveLength(2000);
        // 職長A は毎日 職長（20件）。金額は 9/9 までが 1,500円・200円、9/10 からが 2,000円・300円
        expect(data.filter((d) => d.payRole === 'foreman').map((d) => d.userId)).toEqual(dates.map(() => 'foremanA'));
        expect(Array.from(new Set(data.map((d) => `${String(d.payRole)}:${String(d.amount)}`))).sort())
            .toEqual(['foreman:1500', 'foreman:2000', 'member:200', 'member:300']);
        expect(argsOf<InsertArgs>(prisma.allowanceLog.createMany).data).toHaveLength(2000);
    });

    it('入れる相手が1件も無い → 200 { added: 0, pending: 0, skipped: 送った数 }。トランザクションを開かない', async () => {
        const r = await post({ keys: ['foremanA|2026-09-01', 'worker3|2026-09-01', 'でたらめ', 'でたらめ'] });
        expect([r.status, r.body]).toEqual([200, { added: 0, pending: 0, skipped: 3 }]);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        noWrites();
    });

    it("status は、操作している人自身の分だけ 'pending'。操作している人が変われば、確認待ちになる行も変わる", async () => {
        // 9/1: 職長A の班に、管理者1 とマネージャー1 が入った。3人とも出勤・記録なし
        setWorld({
            assignments: [assignment('foremanA', '2026-09-01', ['admin1', 'manager1'])],
            attendance: present('2026-09-01', 'foremanA', 'admin1', 'manager1'),
        });
        const keys = ['admin1|2026-09-01', 'foremanA|2026-09-01', 'manager1|2026-09-01'];
        const postAs = async (user: { id: string; role: string; name: string }) => {
            loginAs(user);
            mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
            const r = await post({ keys });
            return { body: r.body, rows: Object.fromEntries(insertArgs().data.map((d) => [String(d.userId), `${String(d.status)} / 付けた人 ${String(d.createdBy)}`])) };
        };

        expect(await postAs(ADMIN)).toEqual({
            body: { added: 3, pending: 1, skipped: 0 },
            rows: { admin1: 'pending / 付けた人 admin1', foremanA: 'confirmed / 付けた人 admin1', manager1: 'confirmed / 付けた人 admin1' },
        });
        expect(await postAs(MANAGER)).toEqual({
            body: { added: 3, pending: 1, skipped: 0 },
            rows: { admin1: 'confirmed / 付けた人 manager1', foremanA: 'confirmed / 付けた人 manager1', manager1: 'pending / 付けた人 manager1' },
        });
    });

    it('先の日付（日本時間の今日より後）の key は入れない。今日の分は入る', async () => {
        const dates = ['2026-09-15', '2026-09-16', '2026-09-17'];
        setWorld({
            assignments: dates.map((d) => assignment('foremanA', d, null)),
            attendance: dates.flatMap((d) => present(d, 'foremanA')),
        });
        const keys = dates.map((d) => `foremanA|${d}`);
        // 先の日付は、見比べ（lib）と route の両方で落としている（どちらか片方だけを外しても、入らない）

        freezeNow('2026-09-15T15:30:00.000Z'); // 日本時間 9/16 0:30（UTC ではまだ 9/15）
        const justAfterMidnight = await post({ keys });
        expect([justAfterMidnight.status, justAfterMidnight.body]).toEqual([200, { added: 2, pending: 0, skipped: 1 }]);
        expect(insertArgs().data.map((d) => d.date)).toEqual([utc0('2026-09-15'), utc0('2026-09-16')]);

        mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
        freezeNow('2026-09-15T14:59:00.000Z'); // 日本時間 9/15 23:59
        const justBeforeMidnight = await post({ keys });
        expect([justBeforeMidnight.status, justBeforeMidnight.body]).toEqual([200, { added: 1, pending: 0, skipped: 2 }]);
        expect(insertArgs().data.map((d) => d.date)).toEqual([utc0('2026-09-15')]);
    });
});

describe('POST: 書く順番・履歴・入らなかったとき', () => {
    it('順番は「トランザクションを開く → 鍵を取る → 締めてあるかを読む → 入れる → 履歴」。全部を1回のトランザクションで行う', async () => {
        expect((await post()).status).toBe(200);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        // トランザクションの設定を渡す: 始められるまで待つのは 5秒まで・始めてから終わるまでは 10秒まで（鍵が空くのを待つ時間は、この 10秒に入る）
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 10000 });
        expect(lockSqls()).toEqual(["SELECT pg_advisory_xact_lock(hashtext('dandolink-allowance'))"]);
        // 締めた月の表は2回読む。1回目は、先に知らせるため（鍵の前）。2回目が、鍵を取ったあとの確かめ
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(2);
        expect(argsOf(prisma.allowanceMonthClose.findMany, 1)).toEqual({ where: { month: { in: [MONTH] } }, select: { month: true } });
        expect(prisma.allowanceLog.createMany).toHaveBeenCalledTimes(1);

        const steps = [
            orderOf(prisma.allowanceMonthClose.findMany, 0),
            orderOf(prisma.$transaction),
            orderOf(prisma.$executeRaw),
            orderOf(prisma.allowanceMonthClose.findMany, 1),
            orderOf(prisma.allowanceRecord.createManyAndReturn),
            orderOf(prisma.allowanceLog.createMany),
        ];
        expect(steps.every((n) => typeof n === 'number')).toBe(true);
        expect(steps).toEqual([...steps].sort((a, b) => a - b));

        // 金額は2回読む。1回目は見比べのとき（鍵の前）。2回目が、鍵を取ったあと・入れる前の読み直し（どちらも、その手当の分だけ）
        expect(mock(prisma.allowanceRate.findMany).mock.calls.map((c) => c[0] as unknown)).toEqual([rateArgs('large'), rateArgs('large')]);
        const rateSteps = [
            orderOf(prisma.allowanceRate.findMany, 0),
            orderOf(prisma.$transaction),
            orderOf(prisma.$executeRaw),
            orderOf(prisma.allowanceRate.findMany, 1),
            orderOf(prisma.allowanceRecord.createManyAndReturn),
        ];
        expect(rateSteps).toEqual([...rateSteps].sort((a, b) => a - b));
    });

    it('履歴は、入った行ごとに1行（record_added。金額・区分・状態・source の写しつき）', async () => {
        expect((await post({ keys: ['worker1|2026-09-01', 'admin1|2026-09-10'] })).body).toEqual({ added: 2, pending: 1, skipped: 0 });
        expect(prisma.allowanceLog.createMany).toHaveBeenCalledTimes(1);
        expect(argsOf(prisma.allowanceLog.createMany)).toEqual({
            data: [
                {
                    action: 'record_added', actorId: 'admin1', actorName: '管理者1',
                    targetUserId: 'worker1', itemId: 'large', recordId: 'new-1', recordDate: utc0('2026-09-01'),
                    detail: { itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed', source: 'bulk' },
                },
                {
                    action: 'record_added', actorId: 'admin1', actorName: '管理者1',
                    targetUserId: 'admin1', itemId: 'large', recordId: 'new-2', recordDate: utc0('2026-09-10'),
                    detail: { itemName: '大規模手当', payRole: 'member', amount: 300, status: 'pending', source: 'bulk' },
                },
            ],
        });
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    });

    it('同時に別の端末が先に付けていて、入らなかった行がある → added は入った件数。入らなかった分は skipped・履歴も入った行だけ', async () => {
        // skipDuplicates で、5行のうち2行（作業員1・管理者1）だけが入った（createManyAndReturn が返すのは、実際に入った行だけ）
        mock(prisma.allowanceRecord.createManyAndReturn).mockImplementation(async ({ data }: InsertArgs) =>
            asInserted(data).filter((row) => row.userId === 'worker1' || row.userId === 'admin1'));
        const withSelf = await post();
        expect([withSelf.status, withSelf.body]).toEqual([200, { added: 2, pending: 1, skipped: 3 }]);
        expect(argsOf<InsertArgs>(prisma.allowanceLog.createMany).data.map((d) => d.targetUserId)).toEqual(['worker1', 'admin1']);

        // 管理者1 自身の行が入らなかったときは、pending は 0（pending は、入った分のうちの確認待ち）
        mock(prisma.allowanceRecord.createManyAndReturn).mockImplementation(async ({ data }: InsertArgs) =>
            asInserted(data).filter((row) => row.userId !== 'admin1'));
        const withoutSelf = await post();
        expect([withoutSelf.status, withoutSelf.body]).toEqual([200, { added: 4, pending: 0, skipped: 1 }]);
    });

    it('1行も入らなかった（全部が先に付いていた）→ 200 { added: 0, pending: 0, skipped: 送った数 }・履歴なし', async () => {
        mock(prisma.allowanceRecord.createManyAndReturn).mockResolvedValue([]);
        const r = await post();
        expect([r.status, r.body]).toEqual([200, { added: 0, pending: 0, skipped: 5 }]);
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
    });

    it('読んでから入れるまでのあいだに月が締められた → 400「この月は締めてあります（管理者が締めを外すと、変えられます）」。記録も履歴も書かない', async () => {
        mock(prisma.allowanceMonthClose.findMany)
            .mockResolvedValueOnce([])                    // 最初の確かめ（先に知らせる用）: まだ締めていない
            .mockResolvedValueOnce([{ month: MONTH }]);   // 鍵を取ったあとの確かめ: 締められていた
        const r = await post();
        expect([r.status, r.body.error]).toEqual([400, 'この月は締めてあります（管理者が締めを外すと、変えられます）']);

        // 2回目の確かめは、鍵を取ったあと
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(2);
        expect(orderOf(prisma.$executeRaw)).toBeLessThan(orderOf(prisma.allowanceMonthClose.findMany, 1));
        expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
    });

    it('DB に書くときに例外が起きたら 500（操作の名前は「手当をまとめて付ける処理」）。履歴は書かない', async () => {
        mock(prisma.allowanceRecord.createManyAndReturn).mockRejectedValue(new Error('DB に届かない'));
        const r = await post();
        // serverErrorResponse(操作の名前, 例外)。モックでは、操作の名前が error に入る
        expect([r.status, r.body.error]).toEqual([500, '手当をまとめて付ける処理']);
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
    });
});

describe('POST: 金額の無い日（手当が始まる前の日・金額の行が無い手当）は、400 にせず、入れない（skipped に数える）', () => {
    it('金額の行が1つも無い手当 → 付くはずの日が無いので、何を送っても入れない（400 にしない。200・skipped。トランザクションを開かない）', async () => {
        answer(prisma.allowanceRate.findMany, []);
        const r = await post();
        expect([r.status, r.body]).toEqual([200, { added: 0, pending: 0, skipped: 5 }]);
        noWrites();
    });

    it('手当が始まる前の日の key は入れない（skipped）。始まりの日からの分は入る', async () => {
        // 金額は 9/10 からの1行だけ ＝ 始まりの日は 9/10。9月の例の missing のうち、9/1・9/3 の2件は「始まる前」
        answer(prisma.allowanceRate.findMany, RATES_FROM_10TH);
        const r = await post();
        expect([r.status, r.body]).toEqual([200, { added: 3, pending: 1, skipped: 2 }]);
        expect(insertArgs().data).toEqual([
            newRow('admin1', '2026-09-10', 'member', 300, 'rate2', 'pending'),
            newRow('foremanA', '2026-09-10', 'member', 300, 'rate2', 'confirmed'),
            newRow('foremanB', '2026-09-10', 'foreman', 2000, 'rate2', 'confirmed'),
        ]);
    });

    it('鍵を取ったあとで読み直した金額に、その日付の分が無い → その分だけ入れずに skipped。金額のある日付の分は入る（ふつうは起きない。念のための守り）', async () => {
        mock(prisma.allowanceRate.findMany)
            .mockResolvedValueOnce(RATES)                // 見比べのとき: 9/1 から金額がある
            .mockResolvedValueOnce(RATES_FROM_10TH);     // 鍵を取ったあと: 9/10 からの行しか無い
        const r = await post();
        expect([r.status, r.body]).toEqual([200, { added: 3, pending: 1, skipped: 2 }]);
        // 9/1 の作業員1・9/3 の職長B は入れない。9/10 の3人は入る
        expect(insertArgs().data.map((d) => `${String(d.userId)}|${(d.date as Date).toISOString().slice(0, 10)}`))
            .toEqual(['admin1|2026-09-10', 'foremanA|2026-09-10', 'foremanB|2026-09-10']);
        expect(argsOf<InsertArgs>(prisma.allowanceLog.createMany).data).toHaveLength(3);
    });

    it('鍵を取ったあとで読み直したら、金額の行が1つも無い → 1件も入れない（記録の表にも履歴にも書かない）。400 にせず 200・skipped', async () => {
        mock(prisma.allowanceRate.findMany)
            .mockResolvedValueOnce(RATES)   // 見比べのとき
            .mockResolvedValueOnce([]);     // 鍵を取ったあと
        const r = await post();
        expect([r.status, r.body]).toEqual([200, { added: 0, pending: 0, skipped: 5 }]);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledTimes(2);
        expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
    });
});
