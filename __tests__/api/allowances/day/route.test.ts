/**
 * @jest-environment node
 *
 * GET・PUT /api/allowances/day（「出勤簿入力」の手当のボタン用）のテスト。
 *
 * route は lib/allowances.ts・lib/allowancesServer.ts の関数を本物のまま呼ぶ（lib はモックにしない）。
 * この route が使うもののうち、モックなのは、jest.setup.ts が差し替えている @/lib/prisma と @/lib/api/utils だけ
 * （決めた答えを返すだけで、DB にはつながない）。
 * だから「絞り込みが正しいか」は、返ってきた値ではなく、findMany・findFirst・deleteMany などに渡した引数で確かめる。
 *
 * このファイルのモックのうち、渡された引数を見て答えを変えるのは4つだけ:
 *   - prisma.projectAssignment.findMany … 1回の要求の中で2種類の読み方で呼ばれる。どちらも、同じ「その日の手配」（assignments）から答える。
 *       班のメンバー用（where に assignedEmployeeId がある。select は { confirmedWorkerIds: true }）→ その職長の手配だけ
 *       その日の手配用（where に assignedEmployeeId が無い。select に projectMaster がある）→ 全部の職長の手配
 *       日付（where.date）と isBackfilled は見ない＝どの日でも同じ手配を返す（日時は、聞かれた日の日本時間 0時＝where.date.gte にして返す）
 *   - prisma.user.findMany … 聞かれた ID（where.id.in）の人のうち、在籍の人を、人の表（users）から返す
 *   - prisma.allowanceMonthClose.findMany … 聞かれた月（where.month.in）のうち、締めてある月（closedMonths）だけを返す
 *   - prisma.allowanceItem.findUnique … 聞かれた ID の手当（ITEMS）を返す。無ければ null
 *
 * 何も変えなければ: 職長A の班が、工事内容「大規模」の現場に入っている日。
 * 手配確定のメンバーは 作業員1・職長B（役職は職長だが、この日は職長A の班のメンバー）・協力会社のメンバー。
 *
 * 日付: ふだんは過去の決まった日（2026-09-10）。金額を変える前後は 2026-09-30・2026-10-01。「先の日付」は遠い先（2099年）。
 * 大規模手当の始まりの日（いちばん古い適用開始日）は 2026-09-01。「手当が始まる前の日付」には、その前の日（2026-08-31）を使う。
 * 「今日」を見る決まりを確かめるテストだけ、時計を固定する（freezeNow）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, PUT, dynamic } from '@/app/api/allowances/day/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;

const DAY = '2026-09-10';        // ふだん使う日（金額は 9/1 からの、職長 1,500円・職長以外 200円）
const DAY_BEFORE = '2026-09-30'; // 金額を変える前の日
const DAY_AFTER = '2026-10-01';  // 金額を変えた日（適用開始日。職長 2,000円・職長以外 300円）
const START_DAY = '2026-09-01';     // 大規模手当の始まりの日（いちばん古い適用開始日）
const BEFORE_START = '2026-08-31';  // 手当が始まる前の日
const FUTURE = '2099-12-31';     // 先の日付
/** その日付に有効な金額が無い（手当が始まる前の日付・金額の行が1つも無い）ときに返る文言（lib/allowances.ts の ALLOWANCE_NO_RATE_MESSAGE） */
const NO_RATE_MESSAGE = 'この日付には、この手当の金額が設定されていません（手当が始まる前の日付には付けられません）';
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

interface DayItemBody { id: string; name: string; description: string | null; foremanAmount: number; memberAmount: number }
interface DayOfferBody { itemId: string; payRole: string; amount: number }
interface DayRecordBody {
    id: string; itemId: string; itemName: string; payRole: string; amount: number; status: string;
    createdBy: string; createdByName: string; canRemove: boolean;
}
interface DayMemberBody { userId: string; eligible: boolean; offers: DayOfferBody[]; records: DayRecordBody[] }
interface PutBody { result?: string; monthClosed?: boolean; member?: { userId: string; records: DayRecordBody[] }; error?: string; details?: string }
interface GetBody { date?: string; foremanId?: string; monthClosed?: boolean; items?: DayItemBody[]; members?: DayMemberBody[]; error?: string; details?: string }

const putRaw = async (rawBody: string) => {
    const res = await PUT(new NextRequest('http://localhost/api/allowances/day', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
    }));
    return { status: res.status, body: (await res.json()) as PutBody, res };
};
/** 何も指定しなければ「職長A の班の画面で、作業員1 に、大規模手当を付ける」 */
const put = (over: Record<string, unknown> = {}) =>
    putRaw(JSON.stringify({ foremanId: 'foremanA', date: DAY, userId: 'worker1', itemId: 'large', on: true, ...over }));

const get = async (query: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/allowances/day?${query}`));
    return { status: res.status, body: (await res.json()) as GetBody, res };
};
/** 何も指定しなければ「職長A の班の、ふだんの日」 */
const getDay = (date: string = DAY, foremanId: string = 'foremanA') =>
    get(`foremanId=${encodeURIComponent(foremanId)}&date=${encodeURIComponent(date)}`);

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string; username?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });

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

// ---------------------------------------------------------------- モックが返す材料

/** 人の表の1行。role は DB の値（大文字）。isActive: false は、在籍でない人 */
interface UserRow { id: string; displayName: string; role: string; isActive?: boolean }
const allUsers = (): UserRow[] => [
    { id: 'foremanA', displayName: '職長A', role: 'FOREMAN2' },
    { id: 'foremanB', displayName: '職長B', role: 'FOREMAN1' },
    { id: 'foremanC', displayName: '職長C', role: 'FOREMAN2' },
    { id: 'worker1', displayName: '作業員1', role: 'WORKER' },
    { id: 'worker2', displayName: '作業員2', role: 'WORKER' },
    { id: 'partner1', displayName: '協力会社のメンバー', role: 'PARTNER_MEMBER' },
    { id: 'manager1', displayName: 'マネージャー', role: 'MANAGER' },
    { id: 'admin1', displayName: '管理者', role: 'ADMIN' },
    { id: 'gone1', displayName: '在籍でない人', role: 'WORKER', isActive: false },
];
/** 人の表。テストごとに差し替える */
let users: UserRow[] = [];

/** 手配の1件（1人の職長の班の、1つの現場への配置） */
interface Assignment {
    /** その班の職長（assignedEmployeeId） */
    foremanId: string;
    /** その案件の工事内容（ProjectMaster.constructionContent。旧い値も入る）。null は未設定 */
    content: string | null;
    /** 手配確定のメンバー（JSON の文字） */
    confirmedWorkerIds: string | null;
    /** true = 案件が読めない（projectMaster が null） */
    noProject?: boolean;
}
const assign = (foremanId: string, content: string | null, workerIds: string[] = []): Assignment =>
    ({ foremanId, content, confirmedWorkerIds: JSON.stringify(workerIds) });
/** 何も変えなければの、職長A の班の手配確定メンバー */
const CREW = ['worker1', 'foremanB', 'partner1'];
/** その日の手配（全部の職長ぶん）。テストごとに差し替える */
let assignments: Assignment[] = [];
/** 締めてある月（'YYYY-MM'）。テストごとに差し替える */
let closedMonths: string[] = [];

const ITEMS: Record<string, { id: string; name: string; isActive: boolean; constructionContent: string }> = {
    large: { id: 'large', name: '大規模手当', isActive: true, constructionContent: '大規模' },
    // 使っていない手当（対象の現場は、大規模手当と同じ）
    old: { id: 'old', name: '夜間手当（旧）', isActive: false, constructionContent: '大規模' },
    // 対象の現場が違う手当
    reform: { id: 'reform', name: '改修手当', isActive: true, constructionContent: '改修' },
    // 対象の工事内容が空の手当
    blank: { id: 'blank', name: '対象が空の手当', isActive: true, constructionContent: '   ' },
    // 対象の工事内容が、旧い値（large_scale ＝ 大規模）で入っている手当
    legacy: { id: 'legacy', name: '高所手当', isActive: true, constructionContent: 'large_scale' },
};

/** 金額の履歴。大規模手当は、9/1 から 職長 1,500円・職長以外 200円、10/1 から 2,000円・300円 */
const rateRows = () => [
    { id: 'rate1', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
    { id: 'rate2', itemId: 'large', foremanAmount: 2000, memberAmount: 300, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-20T01:00:00.000Z') },
    { id: 'rateOld', itemId: 'old', foremanAmount: 800, memberAmount: 400, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
    { id: 'rateReform', itemId: 'reform', foremanAmount: 500, memberAmount: 100, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
    { id: 'rateBlank', itemId: 'blank', foremanAmount: 900, memberAmount: 90, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
    { id: 'rateLegacy', itemId: 'legacy', foremanAmount: 600, memberAmount: 60, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
];

/** すでに付いている記録（findFirst が返す行＝全部の列）。何も指定しなければ「職長A が、作業員1 に付けた大規模手当」 */
const recordRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1', userId: 'worker1', date: utc0(DAY), itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200,
    rateId: 'rate1', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null,
    createdBy: 'foremanA', createdByName: '職長A', confirmedBy: null, confirmedByName: null, confirmedAt: null,
    createdAt: new Date('2026-09-10T09:00:00.000Z'), updatedAt: new Date('2026-09-10T09:00:00.000Z'), ...over,
});

/** その日の記録（応答を作るために findMany が返す行＝画面に出す列だけ）。何も指定しなければ recordRow() と同じ記録 */
const dayRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1', userId: 'worker1', itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200,
    status: 'confirmed', createdBy: 'foremanA', createdByName: '職長A', ...over,
});

// ---------------------------------------------------------------- 確かめるための部品

/** そのモックの n 回目の呼び出しに渡した、最初の引数 */
const argOf = <T>(fn: unknown, n = 0): T => mock(fn).mock.calls[n][0] as T;

/** そのモックが呼ばれた順番（全部のモックを通した連番。小さいほうが先） */
const orderOf = (fn: unknown): number[] => mock(fn).mock.invocationCallOrder;

interface AssignmentQuery {
    where: { assignedEmployeeId?: string; date: { gte: Date; lt: Date }; isBackfilled: boolean };
    select: Record<string, unknown>;
}
const assignmentReads = () => mock(prisma.projectAssignment.findMany).mock.calls.map((c) => c[0] as AssignmentQuery);
/** projectAssignment.findMany の呼び出しのうち、班のメンバー用（その職長の手配だけを読む） */
const memberReads = () => assignmentReads().filter((q) => !('projectMaster' in q.select));
/** projectAssignment.findMany の呼び出しのうち、その日の手配用（全部の職長ぶんを読む） */
const dayReads = () => assignmentReads().filter((q) => 'projectMaster' in q.select);

/** 記録を足すときに渡した行（createManyAndReturn の data。呼んだ順） */
const addedData = (): Record<string, unknown>[] =>
    mock(prisma.allowanceRecord.createManyAndReturn).mock.calls.flatMap((c) => (c[0] as { data: Record<string, unknown>[] }).data);

/** 書かれた履歴の行。1行ずつ書く create と、まとめて書く createMany のどちらで書いても、同じに見えるようにする */
const writtenLogs = (): Record<string, unknown>[] => {
    const rowsOf = (call: unknown[]) => {
        const { data } = call[0] as { data: Record<string, unknown> | Record<string, unknown>[] };
        return Array.isArray(data) ? data : [data];
    };
    return [...mock(prisma.allowanceLog.create).mock.calls, ...mock(prisma.allowanceLog.createMany).mock.calls].flatMap(rowsOf);
};
/** 履歴を最初に書いた順番 */
const firstLogOrder = () => Math.min(...orderOf(prisma.allowanceLog.create), ...orderOf(prisma.allowanceLog.createMany));

const byUser = (members: DayMemberBody[] | undefined): Record<string, DayMemberBody> =>
    Object.fromEntries((members ?? []).map((m) => [m.userId, m]));
/** 応答の members を「人の ID → その人に付けられる手当（'手当:区分:金額'。応答の順）」にする（人の並びによらない） */
const offersByUser = (members: DayMemberBody[] | undefined): Record<string, string[]> =>
    Object.fromEntries((members ?? []).map((m) => [m.userId, m.offers.map((o) => `${o.itemId}:${o.payRole}:${o.amount}`)]));
/** 応答の記録を「記録の ID → canRemove」にする（人の並び・記録の並びによらない） */
const canRemoveById = (members: DayMemberBody[] | undefined): Record<string, boolean> =>
    Object.fromEntries((members ?? []).flatMap((m) => m.records).map((x) => [x.id, x.canRemove]));

const WRITE_METHODS = ['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];
/** その表のモックのうち、呼ばれたもの（'表.メソッド'）。methods を省くと、読むメソッドも含めた全部 */
const calledOn = (tables: Record<string, object>, methods?: string[]): string[] =>
    Object.entries(tables).flatMap(([table, delegate]) =>
        Object.entries(delegate as Record<string, unknown>)
            .filter(([method, fn]) => (!methods || methods.includes(method)) && jest.isMockFunction(fn) && fn.mock.calls.length > 0)
            .map(([method]) => `${table}.${method}`));

/** 手当の表（記録・履歴・締め・手当・金額・設定）に、何も書いていないこと。トランザクションを開いたかどうかは見ない */
const noRecordWrites = () => {
    expect(calledOn({
        allowanceRecord: prisma.allowanceRecord, allowanceLog: prisma.allowanceLog, allowanceMonthClose: prisma.allowanceMonthClose,
        allowanceItem: prisma.allowanceItem, allowanceRate: prisma.allowanceRate, allowanceSetting: prisma.allowanceSetting,
    }, WRITE_METHODS)).toEqual([]);
};

/** 断ったとき: トランザクションを開いていない・鍵も取っていない・記録も履歴も、何も書いていないこと */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    noRecordWrites();
};

/** DB を読んでいないこと（手配・人・手当・金額・締め・記録のどれも） */
const noReads = () => {
    expect(calledOn({
        projectAssignment: prisma.projectAssignment, user: prisma.user, allowanceItem: prisma.allowanceItem, allowanceRate: prisma.allowanceRate,
        allowanceMonthClose: prisma.allowanceMonthClose, allowanceRecord: prisma.allowanceRecord,
    })).toEqual([]);
};

beforeEach(() => {
    jest.clearAllMocks();
    // requireAuth の既定のモックには name・username が無いので、テストごとに入れる
    loginAs({ id: 'foremanA', role: 'foreman2', name: '職長A' });

    // 職長A の班が、工事内容「大規模」の現場に入っている日。手配確定のメンバーは 作業員1・職長B・協力会社のメンバー
    users = allUsers();
    assignments = [assign('foremanA', '大規模', CREW)];
    mock(prisma.projectAssignment.findMany).mockImplementation(async ({ where, select }: AssignmentQuery) => {
        const rows = assignments.filter((a) => where.assignedEmployeeId === undefined || a.foremanId === where.assignedEmployeeId);
        // 班のメンバー用の読み方
        if (!('projectMaster' in select)) return rows.map((a) => ({ confirmedWorkerIds: a.confirmedWorkerIds }));
        // その日の手配用の読み方（日時は、聞かれた日の日本時間 0時）
        return rows.map((a, i) => ({
            assignedEmployeeId: a.foremanId,
            date: where.date.gte,
            confirmedWorkerIds: a.confirmedWorkerIds,
            projectMasterId: `project-${i + 1}`,
            projectMaster: a.noProject ? null : { title: `現場${i + 1}`, constructionContent: a.content },
        }));
    });
    mock(prisma.user.findMany).mockImplementation(async ({ where }: { where: { id: { in: string[] }; isActive?: boolean } }) =>
        users
            .filter((u) => where.id.in.includes(u.id) && (where.isActive !== true || u.isActive !== false))
            .map((u) => ({ id: u.id, displayName: u.displayName, role: u.role })));

    mock(prisma.allowanceItem.findUnique).mockImplementation(async ({ where }: { where: { id: string } }) => ITEMS[where.id] ?? null);
    // 「出勤簿入力」に出す手当（findMany が返すのは、使用中で絞って、並べたあとの行）
    mock(prisma.allowanceItem.findMany).mockResolvedValue([
        { id: 'large', name: '大規模手当', description: '大規模の現場に入った日', constructionContent: '大規模' },
    ]);
    mock(prisma.allowanceRate.findMany).mockResolvedValue(rateRows());

    closedMonths = []; // どの月も締めていない
    mock(prisma.allowanceMonthClose.findMany).mockImplementation(async ({ where }: { where: { month: { in: string[] } } }) =>
        closedMonths.filter((month) => where.month.in.includes(month)).map((month) => ({ month })));

    mock(prisma.allowanceRecord.findFirst).mockResolvedValue(null);   // まだ付いていない
    mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);       // 応答の records 用の読み直し
    // createManyAndReturn は「入った行の配列」を返すようにする
    mock(prisma.allowanceRecord.createManyAndReturn).mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) =>
        data.map((d, i) => ({ id: `new-${i + 1}`, ...d })));
    // deleteMany は { count } を返すようにする（jest.fn() のままだと undefined が返り、route が 500 になる）
    mock(prisma.allowanceRecord.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.allowanceLog.create).mockResolvedValue({});
    mock(prisma.allowanceLog.createMany).mockResolvedValue({ count: 1 });
});

afterEach(() => {
    jest.useRealTimers();
});

// ================================================================ PUT

describe('PUT /api/allowances/day: 確かめる順番（合わなければ、その時点で断る。何も保存しない）', () => {
    it('ログインしていなければ 401', async () => {
        mock(requireAuth).mockResolvedValue({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) });
        const r = await put();
        expect([r.status, r.body.error]).toEqual([401, '認証が必要です']);
        noReads();
        noWrites();
    });

    it('付けられるロールでない人（作業員・協力会社・税理士・応援）は 403「権限がありません」。foremanId に自分の ID を指定しても 403', async () => {
        // 職長本人は必ず班に入るので、ロールで止めないと、作業員が foremanId に自分を指定して自分に申請できてしまう
        for (const role of ['worker', 'partner', 'partner_member', 'accountant', 'support', '']) {
            loginAs({ id: 'worker1', role, name: '作業員1' });
            for (const foremanId of ['foremanA', 'worker1']) {
                for (const on of [true, false]) {
                    const r = await put({ foremanId, userId: 'worker1', on });
                    expect([role, foremanId, on, r.status, r.body.error]).toEqual([role, foremanId, on, 403, '権限がありません']);
                }
            }
        }
        // ロールの入っていない session も 403
        mock(requireAuth).mockResolvedValue({ session: { user: { id: 'foremanA' } }, error: null });
        const noRole = await put();
        expect([noRole.status, noRole.body.error]).toEqual([403, '権限がありません']);
        noReads();
        noWrites();
    });

    it('入力の形が違う → 400「入力が不正です」（項目が足りない・型が違う・JSON として読めない・配列。500 にしない）', async () => {
        // 形のまちがいは validationErrorResponse。モックでは、文言が error ではなく details に入る
        const cases: [string, Record<string, unknown>][] = [
            ['on が文字', { on: 'true' }], ['on が数字', { on: 1 }], ['on が null', { on: null }], ['on が無い', { on: undefined }],
            ['foremanId が数字', { foremanId: 1 }], ['foremanId が無い', { foremanId: undefined }],
            ['userId が null', { userId: null }], ['userId が無い', { userId: undefined }],
            ['itemId が配列', { itemId: ['large'] }], ['itemId が無い', { itemId: undefined }],
            ['date が数字', { date: 20260910 }], ['date が無い', { date: undefined }],
        ];
        for (const [label, over] of cases) {
            const r = await put(over);
            expect([label, r.status, r.body.error, r.body.details]).toEqual([label, 400, 'Validation Error', '入力が不正です']);
        }
        const valid = '{"foremanId":"foremanA","date":"2026-09-10","userId":"worker1","itemId":"large","on":true}';
        for (const raw of ['これは JSON ではない', '', '"文字列"', '123', 'true', 'null', '[]', `[${valid}]`]) {
            const r = await putRaw(raw);
            expect([raw, r.status, r.body.error, r.body.details]).toEqual([raw, 400, 'Validation Error', '入力が不正です']);
        }
        noReads();
        noWrites();
    });

    it('日付の形が違う・実在しない日付 → 400「日付が不正です」／先の日付 → 400「先の日付には付けられません」（付けるのも取り消すのも断る）', async () => {
        for (const date of ['2026-02-30', '2026-13-01', '2026/09/10', '2026-9-10', '20260910', '2026-09-10T00:00:00Z', ' 2026-09-10', '']) {
            const r = await put({ date });
            expect([date, r.status, r.body.error, r.body.details]).toEqual([date, 400, 'Validation Error', '日付が不正です']);
        }
        for (const on of [true, false]) {
            const r = await put({ date: FUTURE, on });
            // 決まりで断るものは errorResponse（文言は error に入る）
            expect([on, r.status, r.body]).toEqual([on, 400, { error: '先の日付には付けられません' }]);
        }
        noReads();
        noWrites();
    });

    it('「今日」は日本時間で決まる（UTC ではまだ前の日でも、日本時間の今日なら付けられる。明日からが「先の日付」）', async () => {
        freezeNow('2026-10-31T15:30:00.000Z'); // 日本時間 11/1 0:30（UTC では 10/31）
        expect((await put({ date: '2026-11-01' })).body.result).toBe('added');
        expect((await put({ date: '2026-11-02' })).body.error).toBe('先の日付には付けられません');

        freezeNow('2026-10-31T14:59:00.000Z'); // 日本時間 10/31 23:59
        expect((await put({ date: '2026-11-01' })).body.error).toBe('先の日付には付けられません');
        expect((await put({ date: '2026-10-31' })).body.result).toBe('added');
    });

    it('職長が、ほかの職長の班（foremanId がほかの人）を指定したら 403。その班にメンバーとして入っている職長でも同じ。DB は読まない・書かない', async () => {
        for (const on of [true, false]) {
            const r = await put({ foremanId: 'foremanB', on });
            expect([on, r.status, r.body.error]).toEqual([on, 403, '他の職長の班の手当は扱えません']);
        }
        // 職長B は、この日は職長A の班に入っている。それでも、職長A の班の手当は扱えない（自分の行でも）
        loginAs({ id: 'foremanB', role: 'foreman1', name: '職長B' });
        for (const userId of ['worker1', 'foremanB']) {
            const r = await put({ foremanId: 'foremanA', userId });
            expect([userId, r.status, r.body.error]).toEqual([userId, 403, '他の職長の班の手当は扱えません']);
        }
        noReads();
        noWrites();
    });

    it('職長（foreman1・foreman2）は自分の班で、管理者・マネージャーはどの職長の班でも、付けられる', async () => {
        for (const role of ['foreman1', 'foreman2']) {
            loginAs({ id: 'foremanA', role, name: '職長A' });
            const r = await put();
            expect([role, r.status, r.body.result]).toEqual([role, 200, 'added']);
        }
        for (const role of ['admin', 'manager']) {
            loginAs({ id: `${role}1`, role, name: role });
            const r = await put();
            expect([role, r.status, r.body.result]).toEqual([role, 200, 'added']);
        }
    });

    it('その日の班にいない人は 400／手当をもらえないロールの人（協力会社のメンバー）は 400「手当の対象外の人です」（管理者が押しても・取り消しでも）', async () => {
        // outsider = 人の表に無い ID／worker2 = 会社にはいるが、この日の職長A の手配に入っていない／gone1 = 手配には入っているが、在籍でない
        assignments = [assign('foremanA', '大規模', [...CREW, 'gone1'])];
        for (const role of ['foreman2', 'admin']) {
            loginAs({ id: role === 'admin' ? 'admin1' : 'foremanA', role, name: role });
            for (const on of [true, false]) {
                for (const userId of ['outsider', 'worker2', 'gone1']) {
                    const r = await put({ userId, on });
                    expect([role, on, userId, r.status, r.body]).toEqual([role, on, userId, 400, { error: 'この日の班のメンバーではありません' }]);
                }
                const partner = await put({ userId: 'partner1', on });
                expect([role, on, partner.status, partner.body]).toEqual([role, on, 400, { error: '手当の対象外の人です' }]);
            }
        }
        noWrites();
    });

    it('手当をもらえるのは、社員と常用の一人親方のロール（作業員・職長・マネージャー・管理者）だけ。DB の値が大文字でも同じ', async () => {
        const withGuest = (role: string) => {
            users = [...allUsers(), { id: 'guest', displayName: 'ゲスト', role }];
            assignments = [assign('foremanA', '大規模', ['worker1', 'guest'])];
        };
        for (const role of ['partner', 'PARTNER', 'partner_member', 'ACCOUNTANT', 'support', '']) {
            withGuest(role);
            const r = await put({ userId: 'guest' });
            expect([role, r.status, r.body.error]).toEqual([role, 400, '手当の対象外の人です']);
        }
        noWrites();
        for (const role of ['worker', 'WORKER', 'foreman1', 'FOREMAN2', 'manager', 'ADMIN']) {
            withGuest(role);
            const r = await put({ userId: 'guest' });
            expect([role, r.status, r.body.result]).toEqual([role, 200, 'added']);
        }
    });

    it('見る順番: ロール → 入力の形 → 日付の形 → 先の日付 → ほかの職長の班 → 班のメンバー → 対象のロール（2つ重なったら、先のほうで断る）', async () => {
        // ロール × 入力の形・日付・ほかの職長の班 → 403「権限がありません」
        loginAs({ id: 'worker1', role: 'worker', name: '作業員1' });
        const roleFirst = [await putRaw('これは JSON ではない'), await put({ on: 'true' }), await put({ date: '2026-02-30' }), await put({ date: FUTURE, foremanId: 'foremanB' })];
        expect(roleFirst.map((r) => [r.status, r.body.error])).toEqual(Array(4).fill([403, '権限がありません']));

        loginAs({ id: 'foremanA', role: 'foreman2', name: '職長A' });
        // 入力の形 × 日付の形・先の日付・ほかの職長の班 → 「入力が不正です」
        const shapeFirst = [await put({ on: 'true', date: '2026-02-30' }), await put({ userId: 1, date: FUTURE }), await put({ itemId: null, foremanId: 'foremanB' })];
        expect(shapeFirst.map((r) => [r.status, r.body.details])).toEqual(Array(3).fill([400, '入力が不正です']));
        // 日付の形 × ほかの職長の班 → 「日付が不正です」
        const dateFirst = await put({ date: '2026-02-30', foremanId: 'foremanB' });
        expect([dateFirst.status, dateFirst.body.details]).toEqual([400, '日付が不正です']);
        // 先の日付 × ほかの職長の班 → 400「先の日付には付けられません」（GET は逆で、権限が先）
        const futureFirst = await put({ date: FUTURE, foremanId: 'foremanB' });
        expect([futureFirst.status, futureFirst.body.error]).toEqual([400, '先の日付には付けられません']);
        // ほかの職長の班 × 班にいない人・無い手当 → 403
        const crewFirst = await put({ foremanId: 'foremanB', userId: 'outsider', itemId: 'ghost' });
        expect([crewFirst.status, crewFirst.body.error]).toEqual([403, '他の職長の班の手当は扱えません']);
        noReads();

        // 班にいない人 × 無い手当・対象の現場の手配が無い・締めた月 → 400（200 の 'not_found'・'not_target'・'closed' にしない）
        assignments = [assign('foremanA', '改修', CREW)];
        closedMonths = ['2026-09'];
        const memberFirst = [await put({ userId: 'outsider', itemId: 'ghost' }), await put({ userId: 'outsider' })];
        expect(memberFirst.map((r) => [r.status, r.body.error])).toEqual(Array(2).fill([400, 'この日の班のメンバーではありません']));
        // 対象外のロール × 無い手当・対象の現場の手配が無い・締めた月 → 400
        const eligibleFirst = [await put({ userId: 'partner1', itemId: 'ghost' }), await put({ userId: 'partner1' })];
        expect(eligibleFirst.map((r) => [r.status, r.body.error])).toEqual(Array(2).fill([400, '手当の対象外の人です']));
        noWrites();
    });
});

describe('PUT /api/allowances/day: 付ける（on: true）', () => {
    it("対象の現場の手配のメンバーに付ける → 'added'。記録は「職長以外」の金額・確定で入る。履歴（record_added）が1行書かれる", async () => {
        const r = await put();
        expect([r.status, r.body.result]).toEqual([200, 'added']);

        // 記録: 日付は UTC 0時の印。名前・金額・「職長／職長以外」は、付けた時点の写し
        expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
        expect(argOf(prisma.allowanceRecord.createManyAndReturn)).toEqual({
            data: [{
                userId: 'worker1', date: utc0(DAY), itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, rateId: 'rate1',
                status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null, createdBy: 'foremanA', createdByName: '職長A',
            }],
            // 同時に2台から押されても、同じ記録が2行にならず、例外にもならない
            skipDuplicates: true,
        });
        expect(writtenLogs()).toEqual([{
            action: 'record_added', actorId: 'foremanA', actorName: '職長A',
            targetUserId: 'worker1', itemId: 'large', recordId: 'new-1', recordDate: utc0(DAY),
            detail: { itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed', source: 'attendance' },
        }]);
        expect(prisma.allowanceRecord.deleteMany).not.toHaveBeenCalled();
    });

    it("その手配の職長が自分の行に付ける → 「職長」の金額で、確認待ち（status: 'pending'）", async () => {
        const r = await put({ userId: 'foremanA' });
        expect([r.status, r.body.result]).toEqual([200, 'added']);
        expect(addedData()).toEqual([expect.objectContaining({
            userId: 'foremanA', payRole: 'foreman', amount: 1500, rateId: 'rate1', status: 'pending', foremanId: 'foremanA', createdBy: 'foremanA',
        })]);
        expect(writtenLogs()).toEqual([expect.objectContaining({
            action: 'record_added', targetUserId: 'foremanA',
            detail: { itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'pending', source: 'attendance' },
        })]);
    });

    it('管理者が、職長A の班の画面で付ける: 職長A の行は「職長」で確定、メンバーの行は「職長以外」で確定。foremanId は班の職長、付けた人は管理者', async () => {
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        expect((await put({ userId: 'foremanA' })).body.result).toBe('added');
        expect((await put({ userId: 'worker1' })).body.result).toBe('added');

        const [toForeman, toWorker] = addedData();
        expect(toForeman).toMatchObject({
            userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'confirmed', foremanId: 'foremanA', createdBy: 'admin1', createdByName: '管理者',
        });
        expect(toWorker).toMatchObject({
            userId: 'worker1', payRole: 'member', amount: 200, status: 'confirmed', foremanId: 'foremanA', createdBy: 'admin1', createdByName: '管理者',
        });
        expect(writtenLogs().map((l) => [l.actorId, l.actorName, l.targetUserId])).toEqual([['admin1', '管理者', 'foremanA'], ['admin1', '管理者', 'worker1']]);
        // 班のメンバーは、班の職長（foremanId）の手配から読む（操作している人ではない）
        expect(memberReads().map((q) => q.where.assignedEmployeeId)).toEqual(['foremanA', 'foremanA']);
    });

    it('自分に付けた分は、だれでも確認待ち: 管理者が自分の班（foremanId = 自分）で自分に付ける →「職長」で確認待ち／班に入ったマネージャーが自分に付ける →「職長以外」で確認待ち', async () => {
        // 管理者が、対象の現場の手配の職長になっている日
        assignments = [assign('admin1', '大規模', ['worker1'])];
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        const own = await put({ foremanId: 'admin1', userId: 'admin1' });
        expect([own.status, own.body.result]).toEqual([200, 'added']);
        expect(addedData()[0]).toMatchObject({ userId: 'admin1', payRole: 'foreman', amount: 1500, status: 'pending', foremanId: 'admin1', createdBy: 'admin1' });
        expect(memberReads().map((q) => q.where.assignedEmployeeId)).toEqual(['admin1']);

        // マネージャーが、職長A の対象の現場の手配に、メンバーとして入っている日
        assignments = [assign('foremanA', '大規模', ['worker1', 'manager1'])];
        loginAs({ id: 'manager1', role: 'manager', name: 'マネージャー' });
        const asMember = await put({ userId: 'manager1' });
        expect([asMember.status, asMember.body.result]).toEqual([200, 'added']);
        expect(addedData()[1]).toMatchObject({ userId: 'manager1', payRole: 'member', amount: 200, status: 'pending', foremanId: 'foremanA', createdBy: 'manager1' });
    });

    it('役職が職長の人（foreman1）でも、その日、対象の現場の手配の職長でなければ「職長以外」の金額（自分の班が、対象でない現場に入っている日も）', async () => {
        const cases: [string, Assignment[]][] = [
            ['自分の班の手配が無い日', [assign('foremanA', '大規模', CREW)]],
            ['自分の班は、対象でない現場に入っている日', [assign('foremanA', '大規模', CREW), assign('foremanB', '改修', ['worker2'])]],
        ];
        for (const [label, rows] of cases) {
            for (const login of [{ id: 'foremanA', role: 'foreman2', name: '職長A' }, { id: 'admin1', role: 'admin', name: '管理者' }]) {
                mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
                assignments = rows;
                loginAs(login);
                const r = await put({ userId: 'foremanB' });
                expect([label, login.id, r.status, r.body.result]).toEqual([label, login.id, 200, 'added']);
                expect(addedData()).toEqual([expect.objectContaining({ userId: 'foremanB', payRole: 'member', amount: 200, status: 'confirmed' })]);
            }
        }
    });

    it('区分は、押した画面ではなく、その日の手配で決まる: 班のメンバーが、同じ日に自分の班（対象の現場）の職長でもあれば、ほかの職長の班の画面で押しても「職長」の金額', async () => {
        // 職長B は、職長A の対象の現場の手配のメンバーで、同じ日に、自分の班（対象の現場）の職長でもある
        assignments = [assign('foremanA', '大規模', ['worker1', 'foremanB']), assign('foremanB', 'large_scale', ['worker2'])];

        // 職長A の班の画面で、職長A が押す → 「職長」1,500円。自分で付けた分ではないので、確定。foremanId は、押した画面の職長
        const onA = await put({ userId: 'foremanB' });
        expect([onA.status, onA.body.result]).toEqual([200, 'added']);
        // 職長B の班の画面で、職長B が自分に押す → 同じ「職長」1,500円（こちらは確認待ち）
        loginAs({ id: 'foremanB', role: 'foreman1', name: '職長B' });
        const onB = await put({ foremanId: 'foremanB', userId: 'foremanB' });
        expect([onB.status, onB.body.result]).toEqual([200, 'added']);

        expect(addedData()).toEqual([
            expect.objectContaining({ userId: 'foremanB', payRole: 'foreman', amount: 1500, rateId: 'rate1', status: 'confirmed', foremanId: 'foremanA', createdBy: 'foremanA' }),
            expect.objectContaining({ userId: 'foremanB', payRole: 'foreman', amount: 1500, rateId: 'rate1', status: 'pending', foremanId: 'foremanB', createdBy: 'foremanB' }),
        ]);
        // 職長A の班のほかの人は、今までどおり（職長A は「職長」、作業員1 は「職長以外」）
        loginAs({ id: 'foremanA', role: 'foreman2', name: '職長A' });
        mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
        await put({ userId: 'foremanA' });
        await put({ userId: 'worker1' });
        expect(addedData().map((d) => [d.userId, d.payRole, d.amount])).toEqual([['foremanA', 'foreman', 1500], ['worker1', 'member', 200]]);
    });

    it('表示名が無いセッションでは、名前の写しはログイン名（username）。id にログイン名は使わない', async () => {
        loginAs({ id: 'foremanA', role: 'foreman2' });
        expect((await put()).body.result).toBe('added');
        expect(addedData()[0]).toMatchObject({ createdBy: 'foremanA', createdByName: 'login-foremanA' });
        expect(writtenLogs()[0]).toMatchObject({ actorId: 'foremanA', actorName: 'login-foremanA' });
    });

    it('金額は「記録の日付に有効な金額」の、その人の区分のほう（適用開始日の前の日・当日で変わる。保存した日の金額ではない）', async () => {
        freezeNow('2026-10-05T03:00:00.000Z'); // 保存するのは 10/5（10/1 からの新しい金額が、もう始まっている）
        const dataOf = async (date: string, userId: string) => {
            mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
            expect((await put({ date, userId })).body.result).toBe('added');
            return addedData()[0];
        };
        expect(await dataOf(DAY_BEFORE, 'worker1')).toMatchObject({ amount: 200, rateId: 'rate1', date: utc0(DAY_BEFORE) });
        expect(await dataOf(DAY_AFTER, 'worker1')).toMatchObject({ amount: 300, rateId: 'rate2', date: utc0(DAY_AFTER) });
        expect(await dataOf(DAY_BEFORE, 'foremanA')).toMatchObject({ amount: 1500, rateId: 'rate1' });
        expect(await dataOf(DAY_AFTER, 'foremanA')).toMatchObject({ amount: 2000, rateId: 'rate2' });
        // 金額は、その手当の行を読む
        expect(argOf<{ where: unknown }>(prisma.allowanceRate.findMany).where).toEqual({ itemId: { in: ['large'] } });
    });

    it("同じボタンを2回送っても記録は1件（すでに付いていれば 'unchanged'）。今の記録は「その人・その日（UTC 0時の印）・その手当」で読む", async () => {
        expect((await put()).body.result).toBe('added');
        // 2回目: もう付いている
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        const second = await put();
        expect([second.status, second.body.result]).toEqual([200, 'unchanged']);
        expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
        expect(writtenLogs()).toHaveLength(1);

        // 取り消したときに履歴へ全部の列を写すので、列を絞らずに読む（select を渡さない）
        expect(prisma.allowanceRecord.findFirst).toHaveBeenCalledTimes(2);
        expect(prisma.allowanceRecord.findFirst).toHaveBeenCalledWith({ where: { userId: 'worker1', date: utc0(DAY), itemId: 'large' } });
    });

    it("ほかの班の画面で先に付いていた記録（同じ人・同じ日・同じ手当）があれば 'unchanged'（1人・1日・1つの手当で1件）", async () => {
        // 職長B が、自分の班の画面で、自分に付けていた。同じ日に、職長A の班の画面で、職長B の行を押す
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({
            id: 'b1', userId: 'foremanB', payRole: 'foreman', amount: 1500, status: 'pending', foremanId: 'foremanB', createdBy: 'foremanB', createdByName: '職長B',
        }));
        const r = await put({ userId: 'foremanB' });
        expect([r.status, r.body.result]).toEqual([200, 'unchanged']);
        noRecordWrites();
    });

    it("同時に別の端末が先に入れていて入らなかったら 'unchanged'。履歴は書かない", async () => {
        mock(prisma.allowanceRecord.createManyAndReturn).mockResolvedValue([]); // skipDuplicates で入らなかった
        const r = await put();
        expect([r.status, r.body.result]).toEqual([200, 'unchanged']);
        expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
        // 履歴は、実際に入った行だけ（空の履歴を書きにも行かない）
        expect(writtenLogs()).toEqual([]);
        expect(calledOn({ allowanceLog: prisma.allowanceLog })).toEqual([]);
    });
});

describe('PUT /api/allowances/day: だれに付けられるか（その日の手配で決まる）', () => {
    it("その職長の、対象の現場の手配が無い日は 'not_target'（管理者が押しても・職長の行でも）。何も書かない", async () => {
        const cases: [string, Assignment[]][] = [
            ['別の工事内容の現場だけ', [assign('foremanA', '改修', CREW)]],
            ['旧い値の、別の工事内容の現場だけ', [assign('foremanA', 'renovation', CREW)]],
            ['工事内容が未設定の現場だけ', [assign('foremanA', null, CREW), assign('foremanA', '', CREW), assign('foremanA', '   ', CREW)]],
            ['案件が読めない手配だけ', [{ ...assign('foremanA', '大規模', CREW), noProject: true }]],
        ];
        for (const role of ['foreman2', 'admin']) {
            loginAs({ id: role === 'admin' ? 'admin1' : 'foremanA', role, name: role });
            for (const [label, rows] of cases) {
                assignments = rows;
                for (const userId of ['worker1', 'foremanA']) {
                    const r = await put({ userId });
                    expect([role, label, userId, r.status, r.body]).toEqual([role, label, userId, 200, {
                        result: 'not_target', monthClosed: false, member: { userId, records: [] },
                    }]);
                }
            }
            // その日の手配が1件も無い日（班に並ぶのは、職長本人だけ）
            assignments = [];
            const alone = await put({ userId: 'foremanA' });
            expect([role, alone.status, alone.body.result]).toEqual([role, 200, 'not_target']);
        }
        noRecordWrites();
    });

    it("同じ日に、その職長の「対象でない現場」にだけ入っている人は 'not_target'。対象の現場の手配に入っている人には付けられる", async () => {
        // 職長A のこの日の手配: 改修の現場（作業員1）と、大規模の現場（職長B）。「出勤簿入力」には、2つの現場の人がまとめて並ぶ
        assignments = [assign('foremanA', '改修', ['worker1']), assign('foremanA', '大規模', ['foremanB'])];
        const offSite = await put({ userId: 'worker1' });
        expect([offSite.status, offSite.body.result]).toEqual([200, 'not_target']);
        noRecordWrites();

        expect((await put({ userId: 'foremanB' })).body.result).toBe('added');
        expect((await put({ userId: 'foremanA' })).body.result).toBe('added');
        expect(addedData().map((d) => [d.userId, d.payRole, d.amount])).toEqual([['foremanB', 'member', 200], ['foremanA', 'foreman', 1500]]);
    });

    it("ほかの職長の、対象の現場の手配にだけ入っている人は、この班のメンバーでも 'not_target'（その職長の班の画面でなら付けられる）", async () => {
        // 作業員2 は、職長A の改修の現場と、職長C の大規模の現場の、両方に入っている
        assignments = [assign('foremanA', '改修', ['worker2']), assign('foremanC', '大規模', ['worker2'])];
        for (const userId of ['worker2', 'foremanA']) {
            const r = await put({ userId });
            expect([userId, r.status, r.body.result]).toEqual([userId, 200, 'not_target']);
        }
        noRecordWrites();

        // 職長C の班の画面（管理者が開く）でなら、「職長以外」で付けられる
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        const onC = await put({ foremanId: 'foremanC', userId: 'worker2' });
        expect([onC.status, onC.body.result]).toEqual([200, 'added']);
        expect(addedData()).toEqual([expect.objectContaining({ userId: 'worker2', payRole: 'member', amount: 200, foremanId: 'foremanC' })]);
    });

    it("職長本人でも、自分の班が対象の現場に入っていない日は、自分の班の画面では 'not_target'。ほかの職長の対象の現場に入っていれば、その班の画面で「職長以外」", async () => {
        // 職長A の班は改修の現場。職長A 本人は、同じ日に、職長C の大規模の現場の手配にも入っている
        assignments = [assign('foremanA', '改修', ['worker1']), assign('foremanC', '大規模', ['foremanA'])];
        const own = await put({ userId: 'foremanA' });
        expect([own.status, own.body.result]).toEqual([200, 'not_target']);
        noRecordWrites();

        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        const onC = await put({ foremanId: 'foremanC', userId: 'foremanA' });
        expect([onC.status, onC.body.result]).toEqual([200, 'added']);
        expect(addedData()).toEqual([expect.objectContaining({ userId: 'foremanA', payRole: 'member', amount: 200, foremanId: 'foremanC' })]);
    });

    it('対象の現場の手配に入っていれば付けられる: 旧い値 large_scale の案件・前後に空白のある名前・2つの現場のうち1つが対象・手当の側が旧い値', async () => {
        const cases: [string, Assignment[]][] = [
            ['旧い値 large_scale', [assign('foremanA', 'large_scale', CREW)]],
            ['前後に空白', [assign('foremanA', ' 大規模 ', CREW)]],
            ['別の現場と、対象の現場', [assign('foremanA', '改修', CREW), assign('foremanA', '大規模', CREW)]],
            ['対象の現場と、工事内容が未設定の現場', [assign('foremanA', '大規模', CREW), assign('foremanA', null, CREW)]],
        ];
        for (const [label, rows] of cases) {
            assignments = rows;
            const r = await put();
            expect([label, r.status, r.body.result]).toEqual([label, 200, 'added']);
        }
        // 手当の側の「対象の工事内容」が旧い値でも、同じ工事内容として比べる
        assignments = [assign('foremanA', '大規模', CREW)];
        mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
        const legacy = await put({ itemId: 'legacy', userId: 'foremanA' });
        expect([legacy.status, legacy.body.result]).toEqual([200, 'added']);
        expect(addedData()).toEqual([expect.objectContaining({ itemId: 'legacy', itemName: '高所手当', payRole: 'foreman', amount: 600, rateId: 'rateLegacy' })]);
    });

    it('見比べるのは、その手当の「対象の工事内容」（大規模の現場の日に、対象が改修の手当は付けられない）。対象の工事内容が空の手当は、だれにも付けられない', async () => {
        const onLarge = await put({ itemId: 'reform' });
        expect([onLarge.status, onLarge.body.result]).toEqual([200, 'not_target']);

        // 工事内容が未設定の現場とも合わない
        assignments = [assign('foremanA', null, CREW), assign('foremanA', '', CREW), assign('foremanA', '   ', CREW)];
        const blank = await put({ itemId: 'blank' });
        expect([blank.status, blank.body.result]).toEqual([200, 'not_target']);
        noRecordWrites();

        assignments = [assign('foremanA', 'renovation', CREW)]; // 改修（旧い値）
        const largeOnReform = await put({ itemId: 'large' });
        expect([largeOnReform.status, largeOnReform.body.result]).toEqual([200, 'not_target']);
        const onReform = await put({ itemId: 'reform' });
        expect([onReform.status, onReform.body.result]).toEqual([200, 'added']);
        // 名前も金額も、その手当のもの
        expect(addedData()).toEqual([expect.objectContaining({ itemId: 'reform', itemName: '改修手当', payRole: 'member', amount: 100, rateId: 'rateReform' })]);
    });

    it('その日の手配は、全部の職長ぶんを読む（職長では絞らない・日本時間のその日・取り込み分を除く）。読むのは、付けるときで手当があるときだけ（取り消すとき・無い手当のときは読まない）', async () => {
        expect((await put()).body.result).toBe('added');
        // 手配の日付は「日本時間 0時 = UTC 前日15時」で入っている。9/10 は、UTC 9/9 15:00 から24時間
        const jstDay = { gte: new Date('2026-09-09T15:00:00.000Z'), lt: new Date('2026-09-10T15:00:00.000Z') };
        // 班のメンバー: その職長の手配だけ
        expect(memberReads()).toEqual([{ where: { assignedEmployeeId: 'foremanA', date: jstDay, isBackfilled: false }, select: { confirmedWorkerIds: true } }]);
        // その日の手配: 職長（assignedEmployeeId）では絞らない
        expect(dayReads()).toHaveLength(1);
        expect(dayReads()[0].where).toEqual({ date: jstDay, isBackfilled: false });
        expect(dayReads()[0].select).toMatchObject({
            assignedEmployeeId: true, date: true, confirmedWorkerIds: true, projectMaster: { select: { constructionContent: true } },
        });

        // 取り消すとき
        mock(prisma.projectAssignment.findMany).mockClear();
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        expect((await put({ on: false })).body.result).toBe('removed');
        expect([memberReads().length, dayReads().length]).toEqual([1, 0]);

        // 無い手当を付けようとしたとき
        mock(prisma.projectAssignment.findMany).mockClear();
        expect((await put({ itemId: 'ghost' })).body.result).toBe('not_found');
        expect([memberReads().length, dayReads().length]).toEqual([1, 0]);
    });

    it("無い手当は 'not_found'（付けるのも取り消すのも）。使っていない手当は 'inactive'（管理者が押しても）。何も書かない", async () => {
        for (const role of ['foreman2', 'admin']) {
            loginAs({ id: role === 'admin' ? 'admin1' : 'foremanA', role, name: role });
            for (const on of [true, false]) {
                const ghost = await put({ itemId: 'ghost', on });
                expect([role, on, ghost.status, ghost.body.result]).toEqual([role, on, 200, 'not_found']);
            }
            const inactive = await put({ itemId: 'old' });
            expect([role, inactive.status, inactive.body.result]).toEqual([role, 200, 'inactive']);
        }
        noRecordWrites();
        // 手当は、押された ID で読む
        expect(argOf(prisma.allowanceItem.findUnique)).toMatchObject({
            where: { id: 'ghost' }, select: { id: true, name: true, isActive: true, constructionContent: true },
        });
    });

    it('断る理由を見る順番: 無い手当 → すでに付いている → 締めた月 → 使っていない手当 → 対象の現場の手配に入っていない → 金額が無い（重なったら、先のほうの理由で答える）', async () => {
        const answerOf = async (over: Record<string, unknown>) => {
            const r = await put(over);
            return r.status === 200 ? r.body.result : `${r.status} ${r.body.error}`;
        };
        // 全部が重なった状態から、1つずつ外していく
        assignments = [assign('foremanA', '改修', CREW)];                           // 対象の現場の手配が無い
        closedMonths = ['2026-09'];                                                  // 締めた月
        mock(prisma.allowanceRate.findMany).mockResolvedValue([]);                   // 金額の行が無い
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());       // すでに付いている（モックは where を見ないので、どの手当でも同じ記録を返す）

        expect(await answerOf({ itemId: 'ghost' })).toBe('not_found');
        expect(await answerOf({ itemId: 'old' })).toBe('unchanged');
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(null);
        expect(await answerOf({ itemId: 'old' })).toBe('closed');
        closedMonths = [];
        expect(await answerOf({ itemId: 'old' })).toBe('inactive');
        expect(await answerOf({ itemId: 'large' })).toBe('not_target');
        assignments = [assign('foremanA', '大規模', CREW)];
        expect(await answerOf({ itemId: 'large' })).toBe(`400 ${NO_RATE_MESSAGE}`);
        noRecordWrites();
    });

    it('金額の行が1つも無い手当は 400「この日付には、この手当の金額が設定されていません（…）」。記録も履歴も書かない', async () => {
        mock(prisma.allowanceRate.findMany).mockResolvedValue([]);
        const r = await put();
        expect([r.status, r.body]).toEqual([400, { error: NO_RATE_MESSAGE }]);
        noRecordWrites();
    });
});

describe('PUT /api/allowances/day: 手当が始まる前の日付（いちばん古い適用開始日より前）', () => {
    it('付けようとすると 400「この日付には、この手当の金額が設定されていません（手当が始まる前の日付には付けられません）」。記録も履歴も書かない（管理者が押しても・職長の行でも）', async () => {
        const cases: [string, string][] = [[BEFORE_START, 'worker1'], [BEFORE_START, 'foremanA'], ['2026-08-01', 'worker1'], ['2020-01-15', 'worker1']];
        for (const login of [{ id: 'foremanA', role: 'foreman2', name: '職長A' }, { id: 'admin1', role: 'admin', name: '管理者' }]) {
            loginAs(login);
            for (const [date, userId] of cases) {
                const r = await put({ date, userId });
                expect([login.id, date, userId, r.status, r.body]).toEqual([login.id, date, userId, 400, { error: NO_RATE_MESSAGE }]);
            }
        }
        // 入れる行が無いときは、記録を入れに行かない（空のまま createManyAndReturn を呼ぶこともしない）
        expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
        noRecordWrites();
    });

    it('始まりの日の当日からは付けられる（金額は、最初の金額）。始まりの日は、金額の行の並びによらず、いちばん古い適用開始日', async () => {
        for (const rows of [rateRows(), rateRows().reverse()]) {
            mock(prisma.allowanceRate.findMany).mockResolvedValue(rows);
            mock(prisma.allowanceRecord.createManyAndReturn).mockClear();

            const before = await put({ date: BEFORE_START });
            expect([before.status, before.body.error]).toEqual([400, NO_RATE_MESSAGE]);
            const start = await put({ date: START_DAY });
            expect([start.status, start.body.result]).toEqual([200, 'added']);
            expect(addedData()).toEqual([expect.objectContaining({ date: utc0(START_DAY), payRole: 'member', amount: 200, rateId: 'rate1' })]);
        }
    });

    it('始まりの日は手当ごとに見る（ほかの手当がもう始まっていても、その手当が始まる前の日付には付けられない）', async () => {
        // 改修手当は 9/15 から、大規模手当は 9/1 から。この日の班は、改修と大規模の両方の現場に入っている
        mock(prisma.allowanceRate.findMany).mockResolvedValue(
            rateRows().map((r) => (r.itemId === 'reform' ? { ...r, effectiveFrom: utc0('2026-09-15') } : r)));
        assignments = [assign('foremanA', '改修', CREW), assign('foremanA', '大規模', CREW)];

        const before = await put({ itemId: 'reform', date: '2026-09-14' });
        expect([before.status, before.body]).toEqual([400, { error: NO_RATE_MESSAGE }]);
        noRecordWrites();

        expect((await put({ itemId: 'large', date: '2026-09-14' })).body.result).toBe('added');
        expect((await put({ itemId: 'reform', date: '2026-09-15' })).body.result).toBe('added');
        expect(addedData().map((d) => [d.itemId, d.amount, d.rateId])).toEqual([['large', 200, 'rate1'], ['reform', 100, 'rateReform']]);
    });

    it("すでに付いている記録は、取り消せる（'removed'）。「付ける」は、すでに付いていれば 'unchanged'（400 にしない）", async () => {
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ id: 'early', date: utc0(BEFORE_START) }));
        const add = await put({ date: BEFORE_START });
        expect([add.status, add.body.result]).toEqual([200, 'unchanged']);
        noRecordWrites();

        const remove = await put({ date: BEFORE_START, on: false });
        expect([remove.status, remove.body.result]).toEqual([200, 'removed']);
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'early', status: 'confirmed' } });
        expect(writtenLogs()).toEqual([expect.objectContaining({ action: 'record_removed', recordId: 'early', recordDate: utc0(BEFORE_START) })]);
        // 今の記録は、その日付（UTC 0時の印）で読んでいる
        expect(prisma.allowanceRecord.findFirst).toHaveBeenLastCalledWith({ where: { userId: 'worker1', date: utc0(BEFORE_START), itemId: 'large' } });
    });

    it('金額が無くても、付けないと決まる場合は 400 にしない（金額の行が1つも無い手当でも・始まる前の日付でも）: すでに付いている・取り消す・使っていない手当・対象の現場の手配に入っていない・締めた月', async () => {
        const situations: [string, string, { id: string }[]][] = [
            ['金額の行が1つも無い', DAY, []],
            ['手当が始まる前の日付', BEFORE_START, rateRows()],
        ];
        for (const [label, date, rates] of situations) {
            mock(prisma.allowanceRate.findMany).mockResolvedValue(rates);
            assignments = [assign('foremanA', '大規模', CREW)];
            closedMonths = [];
            const results: Record<string, string | undefined> = {};

            mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ date: utc0(date) }));
            results['すでに付いている'] = (await put({ date })).body.result;
            results['取り消す'] = (await put({ date, on: false })).body.result;

            mock(prisma.allowanceRecord.findFirst).mockResolvedValue(null);
            results['使っていない手当'] = (await put({ date, itemId: 'old' })).body.result;
            assignments = [assign('foremanA', '改修', CREW)];
            results['対象の現場の手配に入っていない'] = (await put({ date })).body.result;
            assignments = [assign('foremanA', '大規模', CREW)];
            closedMonths = [date.slice(0, 7)];
            results['締めた月'] = (await put({ date })).body.result;

            expect([label, results]).toEqual([label, {
                'すでに付いている': 'unchanged', '取り消す': 'removed', '使っていない手当': 'inactive', '対象の現場の手配に入っていない': 'not_target', '締めた月': 'closed',
            }]);
        }
    });
});

describe('PUT /api/allowances/day: 締めた月', () => {
    beforeEach(() => {
        closedMonths = ['2026-09'];
    });

    it("締めた月の日付は、付けるのも取り消すのも 'closed'（管理者・マネージャーでも）。何も書かない", async () => {
        for (const role of ['foreman2', 'manager', 'admin']) {
            loginAs({ id: role === 'foreman2' ? 'foremanA' : `${role}1`, role, name: role });
            mock(prisma.allowanceRecord.findFirst).mockResolvedValue(null);
            const add = await put();
            expect([role, add.status, add.body.result, add.body.monthClosed]).toEqual([role, 200, 'closed', true]);

            mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
            const remove = await put({ on: false });
            expect([role, remove.status, remove.body.result, remove.body.monthClosed]).toEqual([role, 200, 'closed', true]);
        }
        noRecordWrites();
    });

    it('締めてあるかは、記録の日付の月で見る（今日の月ではない）: 9月を締めたら、9/1・9/30 は断り、8/31・10/1 には付けられる', async () => {
        // 8月の日付にも付けられるように、このテストでは、大規模手当が 8/1 から始まっていることにする
        mock(prisma.allowanceRate.findMany).mockResolvedValue([
            { id: 'rate0', itemId: 'large', foremanAmount: 1000, memberAmount: 100, effectiveFrom: utc0('2026-08-01'), createdAt: new Date('2026-08-01T01:00:00.000Z') },
            ...rateRows(),
        ]);
        const results: [string, string | undefined, boolean | undefined][] = [];
        for (const date of ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01']) {
            const r = await put({ date });
            results.push([date, r.body.result, r.body.monthClosed]);
        }
        expect(results).toEqual([
            ['2026-08-31', 'added', false],
            ['2026-09-01', 'closed', true],
            ['2026-09-30', 'closed', true],
            ['2026-10-01', 'added', false],
        ]);
        // 聞くのは、記録の日付の月だけ（何回読むかは決めていないので、重なりを除いて比べる）
        const asked = mock(prisma.allowanceMonthClose.findMany).mock.calls.map((c) => JSON.stringify(c[0]));
        expect(Array.from(new Set(asked))).toEqual([
            JSON.stringify({ where: { month: { in: ['2026-08'] } }, select: { month: true } }),
            JSON.stringify({ where: { month: { in: ['2026-09'] } }, select: { month: true } }),
            JSON.stringify({ where: { month: { in: ['2026-10'] } }, select: { month: true } }),
        ]);
    });

    it('応答の monthClosed は true。記録の canRemove は false（締めていなければ取り消せる記録でも）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([dayRow()]); // 職長A が、作業員1 に付けた記録
        const closed = await put();
        expect(closed.body).toEqual({
            result: 'closed', monthClosed: true,
            member: {
                userId: 'worker1',
                records: [{
                    id: 'r1', itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed',
                    createdBy: 'foremanA', createdByName: '職長A', canRemove: false,
                }],
            },
        });

        // 締めを外すと、同じ記録が取り消せるようになる
        closedMonths = [];
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        const open = await put();
        expect([open.body.result, open.body.monthClosed, open.body.member?.records[0].canRemove]).toEqual(['unchanged', false, true]);
    });

    it("締めた月でも、すでに付いている記録に「付ける」・もう無い記録を「取り消す」は 'unchanged'（もうその状態になっている）。monthClosed は true", async () => {
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        const add = await put();
        expect([add.status, add.body.result, add.body.monthClosed]).toEqual([200, 'unchanged', true]);

        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(null);
        const remove = await put({ on: false });
        expect([remove.status, remove.body.result, remove.body.monthClosed]).toEqual([200, 'unchanged', true]);
        noRecordWrites();
    });
});

describe('PUT /api/allowances/day: 取り消す（on: false）', () => {
    it("取り消す → 'removed'。消す条件は「記録の ID」と「読んだときの status」。履歴（record_removed）に、取り消した記録の全部の列が残る", async () => {
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        const r = await put({ on: false });
        expect([r.status, r.body.result]).toEqual([200, 'removed']);

        // 押した1つだけを消す（ID で消すので、ほかの記録を巻き込まない）
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', status: 'confirmed' } });
        // 履歴の写しは、日付が 'YYYY-MM-DD'、日時が ISO の文字
        expect(writtenLogs()).toEqual([{
            action: 'record_removed', actorId: 'foremanA', actorName: '職長A',
            targetUserId: 'worker1', itemId: 'large', recordId: 'r1', recordDate: utc0(DAY),
            detail: { ...recordRow(), date: DAY, createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z', confirmedAt: null },
        }]);
        expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('認められた記録を取り消したときは、認めた人・認めた日時も履歴に残る（日時は ISO の文字）', async () => {
        // 職長A が自分に付けて、マネージャーが認めた記録を、管理者が取り消す
        const confirmed = {
            id: 'p1', userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'confirmed',
            confirmedBy: 'manager1', confirmedByName: 'マネージャー', confirmedAt: new Date('2026-09-12T02:00:00.000Z'), updatedAt: new Date('2026-09-12T02:00:00.000Z'),
        };
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow(confirmed));
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        expect((await put({ userId: 'foremanA', on: false })).body.result).toBe('removed');
        expect(writtenLogs()).toEqual([{
            action: 'record_removed', actorId: 'admin1', actorName: '管理者',
            targetUserId: 'foremanA', itemId: 'large', recordId: 'p1', recordDate: utc0(DAY),
            detail: {
                ...recordRow(confirmed), date: DAY, createdAt: '2026-09-10T09:00:00.000Z',
                updatedAt: '2026-09-12T02:00:00.000Z', confirmedAt: '2026-09-12T02:00:00.000Z',
            },
        }]);
    });

    it("消えた件数が 0（読んだあとで、ほかの端末が先に取り消した・状態が変わった）→ 'unchanged'。履歴は書かない", async () => {
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        mock(prisma.allowanceRecord.deleteMany).mockResolvedValue({ count: 0 });
        const r = await put({ on: false });
        expect([r.status, r.body.result]).toEqual([200, 'unchanged']);
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
        expect(writtenLogs()).toEqual([]);
    });

    it("もう無い記録の取り消しは 'unchanged'（何も消さない・履歴も書かない）", async () => {
        const r = await put({ on: false });
        expect([r.status, r.body.result]).toEqual([200, 'unchanged']);
        expect(prisma.allowanceRecord.findFirst).toHaveBeenCalledWith({ where: { userId: 'worker1', date: utc0(DAY), itemId: 'large' } });
        noRecordWrites();
    });

    it("職長は、ほかの人（ほかの職長・管理者）が付けた記録を取り消せない → 'blocked' で、記録は残る。管理者・マネージャーは取り消せる", async () => {
        for (const createdBy of ['foremanB', 'admin1']) {
            mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ createdBy, createdByName: `${createdBy}の名前` }));
            const r = await put({ on: false });
            expect([createdBy, r.status, r.body.result]).toEqual([createdBy, 200, 'blocked']);
        }
        noRecordWrites();

        for (const role of ['admin', 'manager']) {
            loginAs({ id: `${role}1`, role, name: role });
            mock(prisma.allowanceRecord.deleteMany).mockClear();
            mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ createdBy: 'foremanB', createdByName: '職長B' }));
            const r = await put({ on: false });
            expect([role, r.status, r.body.result]).toEqual([role, 200, 'removed']);
            expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', status: 'confirmed' } });
        }
    });

    it("自分の行: 確認待ちは取り下げられる（消す条件の status は 'pending'）。認められた後（確定）は 'blocked'", async () => {
        const own = { id: 'p1', userId: 'foremanA', payRole: 'foreman', amount: 1500 };
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ ...own, status: 'pending' }));
        expect((await put({ userId: 'foremanA', on: false })).body.result).toBe('removed');
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'pending' } });

        mock(prisma.allowanceRecord.deleteMany).mockClear();
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ ...own, status: 'confirmed' }));
        expect((await put({ userId: 'foremanA', on: false })).body.result).toBe('blocked');
        expect(prisma.allowanceRecord.deleteMany).not.toHaveBeenCalled();
    });

    it('「使わない」にした手当の記録・対象の現場の手配から外れた人の記録（班には残っている）も、取り消せる', async () => {
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ id: 'o1', itemId: 'old', itemName: '夜間手当（旧）' }));
        expect((await put({ itemId: 'old', on: false })).body.result).toBe('removed');
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenLastCalledWith({ where: { id: 'o1', status: 'confirmed' } });

        // 付けたあとで手配が変わって、その日の班は改修の現場だけになった
        assignments = [assign('foremanA', '改修', CREW)];
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        expect((await put({ on: false })).body.result).toBe('removed');
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenLastCalledWith({ where: { id: 'r1', status: 'confirmed' } });
    });
});

describe('PUT /api/allowances/day: 鍵・応答', () => {
    it('付けるとき: 班と手当を確かめてから、トランザクションを開き、鍵を取り → 締めを確かめ → 今の記録を読み → 記録を書き → 履歴を書く。読み直しは、そのあと', async () => {
        expect((await put()).body.result).toBe('added');
        // 鍵が空くのを待つ時間もトランザクションの時間に入るので、長めの設定を渡す
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 10000 });
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(String(argOf(prisma.$executeRaw))).toContain('pg_advisory_xact_lock');

        const sequence = [
            orderOf(prisma.user.findMany)[0],                          // 班のメンバー
            orderOf(prisma.$transaction)[0],
            orderOf(prisma.$executeRaw)[0],                            // 鍵
            orderOf(prisma.allowanceMonthClose.findMany)[0],           // 締めてあるか（鍵のあとで読む）
            orderOf(prisma.allowanceRecord.findFirst)[0],              // 今の記録
            orderOf(prisma.allowanceRecord.createManyAndReturn)[0],    // 記録を書く
            firstLogOrder(),                                           // 履歴
            orderOf(prisma.allowanceRecord.findMany)[0],               // 応答の records 用の読み直し
        ];
        expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
        expect(sequence.every((n) => Number.isInteger(n))).toBe(true);
    });

    it('取り消すとき: トランザクションを開き、鍵を取り → 締めを確かめ → 今の記録を読み → 記録を消し → 履歴を書く。読み直しは、そのあと', async () => {
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        expect((await put({ on: false })).body.result).toBe('removed');
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 10000 });
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

        const sequence = [
            orderOf(prisma.user.findMany)[0],
            orderOf(prisma.$transaction)[0],
            orderOf(prisma.$executeRaw)[0],
            orderOf(prisma.allowanceMonthClose.findMany)[0],
            orderOf(prisma.allowanceRecord.findFirst)[0],
            orderOf(prisma.allowanceRecord.deleteMany)[0],
            firstLogOrder(),
            orderOf(prisma.allowanceRecord.findMany)[0],
        ];
        expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
        expect(sequence.every((n) => Number.isInteger(n))).toBe(true);
    });

    it('何もしないと決まるとき（締めた月・取り消せない記録・すでに付いている）も、鍵を取ってから、締めと今の記録を読んでいる', async () => {
        const scenarios: [string, () => Promise<{ body: PutBody }>][] = [
            ['closed', async () => { closedMonths = ['2026-09']; return put(); }],
            ['blocked', async () => { closedMonths = []; mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ createdBy: 'admin1' })); return put({ on: false }); }],
            ['unchanged', async () => put()],
        ];
        for (const [expected, run] of scenarios) {
            jest.clearAllMocks();
            expect((await run()).body.result).toBe(expected);
            expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
            const lock = orderOf(prisma.$executeRaw)[0];
            expect([expected, lock < orderOf(prisma.allowanceMonthClose.findMany)[0], lock < orderOf(prisma.allowanceRecord.findFirst)[0]])
                .toEqual([expected, true, true]);
        }
    });

    it('結果ごとの応答: どれも 200 で { result, monthClosed, member: { userId, records } }。Cache-Control は no-store（member に eligible・offers・payRole は入れない）', async () => {
        const scenarios: [string, Record<string, unknown>, () => void][] = [
            ['added', {}, () => undefined],
            ['unchanged', {}, () => mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow())],
            ['removed', { on: false }, () => mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow())],
            ['blocked', { on: false }, () => mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow({ createdBy: 'admin1' }))],
            ['closed', {}, () => { closedMonths = ['2026-09']; }],
            ['not_found', { itemId: 'ghost' }, () => undefined],
            ['inactive', { itemId: 'old' }, () => undefined],
            ['not_target', {}, () => { assignments = [assign('foremanA', '改修', CREW)]; }],
        ];
        for (const [expected, over, prepare] of scenarios) {
            assignments = [assign('foremanA', '大規模', CREW)];
            closedMonths = [];
            mock(prisma.allowanceRecord.findFirst).mockResolvedValue(null);
            prepare();
            const r = await put(over);
            expect([expected, r.status, r.res.headers.get('Cache-Control'), r.body]).toEqual([expected, 200, 'no-store', {
                result: expected, monthClosed: expected === 'closed', member: { userId: 'worker1', records: [] },
            }]);
        }
    });

    it('応答の member は、保存のあとに読み直した、その人・その日の記録（ボタン＝offers は返さない）', async () => {
        // モックは where を見ないので、ほかの人の行も返す。応答に入るのは、その人の行だけ
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            dayRow({ id: 'new-1' }),
            dayRow({ id: 'o1', itemId: 'old', itemName: '夜間手当（旧）', amount: 400, createdBy: 'admin1', createdByName: '管理者' }),
            dayRow({ id: 'f1', userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'pending' }),
        ]);
        const r = await put();
        expect(r.status).toBe(200);
        expect(r.body).toEqual({
            result: 'added',
            monthClosed: false,
            member: {
                userId: 'worker1',
                records: [
                    { id: 'new-1', itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed', createdBy: 'foremanA', createdByName: '職長A', canRemove: true },
                    // 使っていない手当の記録も返す。管理者が付けた記録は、職長には取り消せない
                    { id: 'o1', itemId: 'old', itemName: '夜間手当（旧）', payRole: 'member', amount: 400, status: 'confirmed', createdBy: 'admin1', createdByName: '管理者', canRemove: false },
                ],
            },
        });

        // 読み直しは「その人・その日（UTC 0時の印）」だけで絞る（手当の種類では絞らない）
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        const query = argOf<{ where: unknown; select: unknown }>(prisma.allowanceRecord.findMany);
        expect(query.where).toEqual({ userId: { in: ['worker1'] }, date: utc0(DAY) });
        expect(query.select).toMatchObject({
            id: true, userId: true, itemId: true, itemName: true, payRole: true, amount: true, status: true, createdBy: true, createdByName: true,
        });

        // PUT の member.records は、GET の同じ人の records と同じ中身
        const members = byUser((await getDay()).body.members);
        expect(r.body.member?.records).toEqual(members.worker1.records);
        const own = await put({ userId: 'foremanA' });
        expect(own.body.member).toEqual({ userId: 'foremanA', records: members.foremanA.records });
        expect(own.body.member?.records.map((x) => [x.id, x.payRole, x.status, x.canRemove])).toEqual([['f1', 'foreman', 'pending', true]]);
    });

    it('途中で例外が起きたら 500（付いた・消えたとは答えない）', async () => {
        mock(prisma.allowanceRecord.findFirst).mockRejectedValue(new Error('DB につながらない'));
        const read = await put();
        expect([read.status, read.body.error, read.body.result]).toEqual([500, '手当の保存', undefined]);
        expect(prisma.allowanceRecord.createManyAndReturn).not.toHaveBeenCalled();

        // 履歴が書けなかったとき（本物の DB では、同じトランザクションの記録も取り消される）
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(null);
        mock(prisma.allowanceLog.create).mockRejectedValue(new Error('履歴が書けない'));
        mock(prisma.allowanceLog.createMany).mockRejectedValue(new Error('履歴が書けない'));
        const log = await put();
        expect([log.status, log.body.error, log.body.result]).toEqual([500, '手当の保存', undefined]);
    });

    it('出勤簿のデータ（AttendanceRecord）は、読みも書きもしない（付ける・取り消す・読む のどれでも）', async () => {
        expect((await put()).body.result).toBe('added');
        mock(prisma.allowanceRecord.findFirst).mockResolvedValue(recordRow());
        expect((await put({ on: false })).body.result).toBe('removed');
        expect((await getDay()).status).toBe(200);
        expect(calledOn({ attendanceRecord: prisma.attendanceRecord })).toEqual([]);
    });
});

// ================================================================ GET

describe('GET /api/allowances/day: 確かめる順番', () => {
    it('ログインしていなければ 401', async () => {
        mock(requireAuth).mockResolvedValue({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) });
        const r = await getDay();
        expect([r.status, r.body.error]).toEqual([401, '認証が必要です']);
        noReads();
    });

    it('付けられるロールでない人（作業員・協力会社・税理士・応援）は 403「権限がありません」。foremanId に自分の ID を指定しても 403', async () => {
        for (const role of ['worker', 'partner', 'partner_member', 'accountant', 'support', '']) {
            loginAs({ id: 'worker1', role, name: '作業員1' });
            for (const foremanId of ['foremanA', 'worker1']) {
                const r = await getDay(DAY, foremanId);
                expect([role, foremanId, r.status, r.body.error]).toEqual([role, foremanId, 403, '権限がありません']);
            }
        }
        mock(requireAuth).mockResolvedValue({ session: { user: { id: 'foremanA' } }, error: null });
        expect((await getDay()).status).toBe(403);
        noReads();
    });

    it('foremanId・date が無い（空も）→ 400「入力が不正です」／日付の形が違う・実在しない日付 → 400「日付が不正です」', async () => {
        for (const query of ['', 'foremanId=foremanA', `date=${DAY}`, `foremanId=&date=${DAY}`, 'foremanId=foremanA&date=']) {
            const r = await get(query);
            expect([query, r.status, r.body.error, r.body.details]).toEqual([query, 400, 'Validation Error', '入力が不正です']);
        }
        for (const date of ['2026-02-30', '2026-13-01', '2026/09/10', '2026-9-10', '20260910']) {
            const r = await getDay(date);
            expect([date, r.status, r.body.error, r.body.details]).toEqual([date, 400, 'Validation Error', '日付が不正です']);
        }
        noReads();
    });

    it('職長が、ほかの職長の班を指定したら 403「他の職長の班の手当は扱えません」。その班にメンバーとして入っている職長でも同じ（手配も手当も読まない）', async () => {
        const other = await getDay(DAY, 'foremanB');
        expect([other.status, other.body.error]).toEqual([403, '他の職長の班の手当は扱えません']);
        loginAs({ id: 'foremanB', role: 'foreman1', name: '職長B' });
        const asMember = await getDay(DAY, 'foremanA');
        expect([asMember.status, asMember.body.error]).toEqual([403, '他の職長の班の手当は扱えません']);
        noReads();
    });

    it('職長（foreman1・foreman2）は自分の班を、管理者・マネージャーはどの職長の班も読める', async () => {
        for (const login of [
            { id: 'foremanA', role: 'foreman1' }, { id: 'foremanA', role: 'foreman2' }, { id: 'admin1', role: 'admin' }, { id: 'manager1', role: 'manager' },
        ]) {
            loginAs(login);
            const r = await getDay();
            expect([login.role, r.status, r.body.foremanId, r.body.members?.length]).toEqual([login.role, 200, 'foremanA', 4]);
        }
    });

    it('見る順番: ロール → foremanId・date があるか → 日付の形 → ほかの職長の班 → 先の日付（2つ重なったら、先のほうで断る）', async () => {
        // 入力が足りない × ほかの職長の班 → 400「入力が不正です」
        const shapeFirst = await get('foremanId=foremanB');
        expect([shapeFirst.status, shapeFirst.body.details]).toEqual([400, '入力が不正です']);
        // 日付の形 × ほかの職長の班 → 400「日付が不正です」
        const dateFirst = await getDay('2026-02-30', 'foremanB');
        expect([dateFirst.status, dateFirst.body.details]).toEqual([400, '日付が不正です']);
        // ほかの職長の班 × 先の日付 → 403（空を返すのは、権限を確かめたあと。PUT は逆で、先の日付が先）
        const crewFirst = await getDay(FUTURE, 'foremanB');
        expect([crewFirst.status, crewFirst.body.error]).toEqual([403, '他の職長の班の手当は扱えません']);

        // ロール × 入力が足りない・日付の形・先の日付 → 403「権限がありません」
        loginAs({ id: 'worker1', role: 'worker', name: '作業員1' });
        for (const query of ['', 'foremanId=worker1', 'foremanId=worker1&date=2026-02-30', `foremanId=worker1&date=${FUTURE}`]) {
            const r = await get(query);
            expect([query, r.status, r.body.error]).toEqual([query, 403, '権限がありません']);
        }
        noReads();
    });

    it('先の日付は、DB を読まずに（手配も手当も読まない）、ボタンも人も空で返す（200）', async () => {
        closedMonths = ['2099-12']; // 締めの表に何が入っていても、読まない
        const r = await getDay(FUTURE);
        expect([r.status, r.body]).toEqual([200, { date: FUTURE, foremanId: 'foremanA', monthClosed: false, items: [], members: [] }]);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        noReads();
    });

    it('「今日」は日本時間で決まる（UTC ではまだ前の日でも、日本時間の今日なら返る。明日からが「先の日付」）', async () => {
        const counts = async (date: string) => {
            const { body } = await getDay(date);
            return [body.items?.length, body.members?.length];
        };
        freezeNow('2026-10-31T15:30:00.000Z'); // 日本時間 11/1 0:30（UTC では 10/31）
        expect(await counts('2026-11-01')).toEqual([1, 4]);
        expect(await counts('2026-11-02')).toEqual([0, 0]);

        freezeNow('2026-10-31T14:59:00.000Z'); // 日本時間 10/31 23:59
        expect(await counts('2026-11-01')).toEqual([0, 0]);
        expect(await counts('2026-10-31')).toEqual([1, 4]);
    });

    it("毎回サーバーで実行する設定になっている（dynamic = 'force-dynamic'。前の答えを使い回さない）", () => {
        expect(dynamic).toBe('force-dynamic');
    });

    it('読むだけ: トランザクションを開かない・鍵を取らない・何も書かない。途中で例外が起きたら 500', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([dayRow()]);
        expect((await getDay()).status).toBe(200);
        noWrites();

        mock(prisma.allowanceItem.findMany).mockRejectedValue(new Error('DB につながらない'));
        const r = await getDay();
        expect([r.status, r.body.error, r.body.members]).toEqual([500, '手当の取得', undefined]);
    });
});

describe('GET /api/allowances/day: だれに・どの区分で付けられるか（members[].offers と items）', () => {
    it('応答は { date, foremanId, monthClosed, items, members }。members は班の全員で、{ userId, eligible, offers, records }（payRole は無い）。Cache-Control は no-store', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            dayRow({ id: 'r1' }),
            dayRow({ id: 'r2', userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'pending' }),
        ]);
        const r = await getDay();
        expect(r.status).toBe(200);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        expect(r.body.members).toHaveLength(4);
        // members の並びは決めていないので、人の ID で引く
        expect({ ...r.body, members: byUser(r.body.members) }).toEqual({
            date: DAY,
            foremanId: 'foremanA',
            monthClosed: false,
            items: [{ id: 'large', name: '大規模手当', description: '大規模の現場に入った日', foremanAmount: 1500, memberAmount: 200 }],
            members: {
                // その手配の職長本人は「職長」の金額
                foremanA: {
                    userId: 'foremanA', eligible: true, offers: [{ itemId: 'large', payRole: 'foreman', amount: 1500 }],
                    records: [{ id: 'r2', itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'pending', createdBy: 'foremanA', createdByName: '職長A', canRemove: true }],
                },
                // 手配確定のメンバーは「職長以外」の金額
                worker1: {
                    userId: 'worker1', eligible: true, offers: [{ itemId: 'large', payRole: 'member', amount: 200 }],
                    records: [{ id: 'r1', itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed', createdBy: 'foremanA', createdByName: '職長A', canRemove: true }],
                },
                // 役職が職長でも、この日は職長A の班のメンバーなので「職長以外」
                foremanB: { userId: 'foremanB', eligible: true, offers: [{ itemId: 'large', payRole: 'member', amount: 200 }], records: [] },
                // 協力会社のメンバーは対象外（DB の値は大文字の PARTNER_MEMBER）。ボタンを出さない
                partner1: { userId: 'partner1', eligible: false, offers: [], records: [] },
            },
        });
    });

    it('操作している人が変わっても、offers は同じ（その画面の職長と、その日の手配で決まる）。管理者が自分の班を開いたときは、管理者の行が「職長」', async () => {
        const asForeman = offersByUser((await getDay()).body.members);
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        expect(offersByUser((await getDay()).body.members)).toEqual(asForeman);
        expect(asForeman).toEqual({ foremanA: ['large:foreman:1500'], worker1: ['large:member:200'], foremanB: ['large:member:200'], partner1: [] });

        assignments = [assign('admin1', '大規模', ['worker1'])];
        expect(offersByUser((await getDay(DAY, 'admin1')).body.members)).toEqual({ admin1: ['large:foreman:1500'], worker1: ['large:member:200'] });
    });

    it('同じ日に、その職長の「対象でない現場」にだけ入っている人には、ボタンを出さない（班の人としては返す）', async () => {
        // 職長A のこの日の手配: 改修の現場（作業員1）と、大規模の現場（職長B）
        assignments = [assign('foremanA', '改修', ['worker1']), assign('foremanA', '大規模', ['foremanB'])];
        const r = await getDay();
        expect(offersByUser(r.body.members)).toEqual({ foremanA: ['large:foreman:1500'], foremanB: ['large:member:200'], worker1: [] });
        expect([byUser(r.body.members).worker1.eligible, r.body.items?.map((i) => i.id)]).toEqual([true, ['large']]);
    });

    it('ほかの職長の、対象の現場の手配にだけ入っている人には、この班のメンバーでも出さない。班のだれにも出さない日は、items も空', async () => {
        // 作業員2 は、職長A の改修の現場と、職長C の大規模の現場の、両方に入っている
        assignments = [assign('foremanA', '改修', ['worker2']), assign('foremanC', '大規模', ['worker2'])];
        const onA = await getDay();
        expect([offersByUser(onA.body.members), onA.body.items]).toEqual([{ foremanA: [], worker2: [] }, []]);

        // 職長C の班の画面（管理者が開く）には出る
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        const onC = await getDay(DAY, 'foremanC');
        expect([offersByUser(onC.body.members), onC.body.items?.map((i) => i.id)])
            .toEqual([{ foremanC: ['large:foreman:1500'], worker2: ['large:member:200'] }, ['large']]);
    });

    it('班のメンバーが、同じ日に自分の班（対象の現場）の職長でもあるときは、その人の offers は「職長」で、職長の金額（自分の班が対象でない現場なら「職長以外」）', async () => {
        assignments = [assign('foremanA', '大規模', ['worker1', 'foremanB']), assign('foremanB', 'large_scale', ['worker2'])];
        expect(offersByUser((await getDay()).body.members))
            .toEqual({ foremanA: ['large:foreman:1500'], worker1: ['large:member:200'], foremanB: ['large:foreman:1500'] });
        // 職長B の班の画面でも、職長B は同じ「職長」
        loginAs({ id: 'foremanB', role: 'foreman1', name: '職長B' });
        expect(offersByUser((await getDay(DAY, 'foremanB')).body.members)).toEqual({ foremanB: ['large:foreman:1500'], worker2: ['large:member:200'] });

        // 職長B の班が、対象でない現場（改修）に入っている日
        loginAs({ id: 'foremanA', role: 'foreman2', name: '職長A' });
        assignments = [assign('foremanA', '大規模', ['worker1', 'foremanB']), assign('foremanB', '改修', ['worker2'])];
        expect(offersByUser((await getDay()).body.members))
            .toEqual({ foremanA: ['large:foreman:1500'], worker1: ['large:member:200'], foremanB: ['large:member:200'] });
    });

    it('職長本人でも、自分の班が対象の現場に入っていない日は、自分の班の画面にボタンが出ない。ほかの職長の対象の現場に入っていれば、その班の画面に「職長以外」で出る', async () => {
        assignments = [assign('foremanA', '改修', ['worker1']), assign('foremanC', '大規模', ['foremanA'])];
        const onA = await getDay();
        expect([offersByUser(onA.body.members), onA.body.items]).toEqual([{ foremanA: [], worker1: [] }, []]);

        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        expect(offersByUser((await getDay(DAY, 'foremanC')).body.members)).toEqual({ foremanC: ['large:foreman:1500'], foremanA: ['large:member:200'] });
    });

    it('手当をもらえないロールの人・在籍でない人（班に並ばない人）には出さない。出せる人が班に1人もいなければ、items にも入れない', async () => {
        // 在籍でない人は、班の人としても返さない
        assignments = [assign('foremanA', '大規模', ['partner1', 'gone1'])];
        const r = await getDay();
        expect([offersByUser(r.body.members), r.body.items?.map((i) => i.id)]).toEqual([{ foremanA: ['large:foreman:1500'], partner1: [] }, ['large']]);
        expect(byUser(r.body.members).partner1.eligible).toBe(false);

        // 協力会社が職長の班（管理者が開く）: 職長もメンバーも対象外
        users = [...allUsers(), { id: 'partnerBoss', displayName: '協力会社', role: 'PARTNER' }];
        assignments = [assign('partnerBoss', '大規模', ['partner1'])];
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        const partnerCrew = await getDay(DAY, 'partnerBoss');
        expect([offersByUser(partnerCrew.body.members), partnerCrew.body.items]).toEqual([{ partnerBoss: [], partner1: [] }, []]);
        expect(byUser(partnerCrew.body.members).partnerBoss.eligible).toBe(false);
    });

    it('同じ人が、同じ日の対象の現場の手配に2回出てきても、ボタンは1つ（職長本人がメンバーの中に入っている・対象の現場が2つある）', async () => {
        assignments = [assign('foremanA', '大規模', ['foremanA', 'worker1']), assign('foremanA', 'large_scale', ['worker1', 'worker2'])];
        expect(offersByUser((await getDay()).body.members))
            .toEqual({ foremanA: ['large:foreman:1500'], worker1: ['large:member:200'], worker2: ['large:member:200'] });
    });

    it('items は、使用中の手当を並び順（sortOrder → 作った順）で読み、班のだれかに付けられる手当だけを、その順で返す。offers も同じ順。金額は手当ごと', async () => {
        // findMany が返すのは「使用中で絞って、並べたあと」の行
        mock(prisma.allowanceItem.findMany).mockResolvedValue([
            { id: 'reform', name: '改修手当', description: null, constructionContent: '改修' },
            { id: 'newbuild', name: '新築手当', description: null, constructionContent: '新築' },
            // 手当の側の「対象の工事内容」が旧い値でも、同じ工事内容として比べる
            { id: 'night', name: '夜間手当', description: null, constructionContent: 'large_scale' },
            { id: 'large', name: '大規模手当', description: '大規模の現場に入った日', constructionContent: '大規模' },
        ]);
        mock(prisma.allowanceRate.findMany).mockResolvedValue([
            ...rateRows(),
            { id: 'rateNight', itemId: 'night', foremanAmount: 800, memberAmount: 400, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
            { id: 'rateNew', itemId: 'newbuild', foremanAmount: 600, memberAmount: 60, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
        ]);
        // 職長A のこの日の手配: 大規模の現場（作業員1）と、改修の現場（作業員2）。新築の現場は無い
        assignments = [assign('foremanA', '大規模', ['worker1']), assign('foremanA', 'renovation', ['worker2'])];
        const r = await getDay();
        expect(r.status).toBe(200);
        expect(r.body.items).toEqual([
            { id: 'reform', name: '改修手当', description: null, foremanAmount: 500, memberAmount: 100 },
            { id: 'night', name: '夜間手当', description: null, foremanAmount: 800, memberAmount: 400 },
            { id: 'large', name: '大規模手当', description: '大規模の現場に入った日', foremanAmount: 1500, memberAmount: 200 },
        ]);
        expect(offersByUser(r.body.members)).toEqual({
            foremanA: ['reform:foreman:500', 'night:foreman:800', 'large:foreman:1500'],
            worker1: ['night:member:400', 'large:member:200'],
            worker2: ['reform:member:100'],
        });

        expect(prisma.allowanceItem.findMany).toHaveBeenCalledTimes(1);
        const query = argOf<{ where: unknown; orderBy: unknown; select: unknown }>(prisma.allowanceItem.findMany);
        // 「使わない」手当は読まない
        expect(query.where).toEqual({ isActive: true });
        expect(query.orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
        expect(query.select).toMatchObject({ id: true, name: true, description: true, constructionContent: true });
    });

    it('案件の工事内容が旧い値（large_scale）・前後に空白のある名前でも合う。対象の工事内容が空の手当は、工事内容が未設定の現場とも合わない', async () => {
        for (const content of ['large_scale', ' 大規模 ']) {
            assignments = [assign('foremanA', content, ['worker1'])];
            const r = await getDay();
            expect([content, r.body.items?.map((i) => i.id), offersByUser(r.body.members)])
                .toEqual([content, ['large'], { foremanA: ['large:foreman:1500'], worker1: ['large:member:200'] }]);
        }

        mock(prisma.allowanceItem.findMany).mockResolvedValue([
            { id: 'blank', name: '対象が空の手当', description: null, constructionContent: '   ' },
            { id: 'empty', name: '対象が無い手当', description: null, constructionContent: '' },
        ]);
        mock(prisma.allowanceRate.findMany).mockResolvedValue([
            ...rateRows(),
            { id: 'rateEmpty', itemId: 'empty', foremanAmount: 700, memberAmount: 70, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
        ]);
        assignments = [assign('foremanA', null, ['worker1']), assign('foremanA', '', ['worker1']), assign('foremanA', '   ', ['worker1']), { ...assign('foremanA', '大規模', ['worker1']), noProject: true }];
        const none = await getDay();
        expect([none.status, none.body.items, offersByUser(none.body.members)]).toEqual([200, [], { foremanA: [], worker1: [] }]);
    });

    it('その日の手配は、全部の職長ぶんを読む（職長では絞らない・日本時間のその日・取り込み分を除く）。班のメンバーは、その職長の手配だけ', async () => {
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        expect((await getDay('2026-10-01')).status).toBe(200);
        // 手配の日付は「日本時間 0時 = UTC 前日15時」で入っている。10/1 は、UTC 9/30 15:00 から24時間
        const jstDay = { gte: new Date('2026-09-30T15:00:00.000Z'), lt: new Date('2026-10-01T15:00:00.000Z') };
        expect(memberReads()).toEqual([{ where: { assignedEmployeeId: 'foremanA', date: jstDay, isBackfilled: false }, select: { confirmedWorkerIds: true } }]);
        expect(dayReads()).toHaveLength(1);
        expect(dayReads()[0].where).toEqual({ date: jstDay, isBackfilled: false });
        expect(dayReads()[0].select).toMatchObject({
            assignedEmployeeId: true, date: true, confirmedWorkerIds: true, projectMaster: { select: { constructionContent: true } },
        });
    });

    it('ほかの職長の手配の「手配確定のメンバー」が、配列でない値・空・文字列でない中身でも落ちない（読める ID だけを使う）', async () => {
        assignments = [
            assign('foremanA', '大規模', ['worker1']),
            { foremanId: 'foremanB', content: '大規模', confirmedWorkerIds: null },
            { foremanId: 'foremanB', content: '大規模', confirmedWorkerIds: '' },
            { foremanId: 'foremanC', content: '大規模', confirmedWorkerIds: 'null' },
            { foremanId: 'foremanC', content: '大規模', confirmedWorkerIds: '{}' },
            { foremanId: 'foremanC', content: '大規模', confirmedWorkerIds: '5' },
            { foremanId: 'foremanC', content: '大規模', confirmedWorkerIds: '"worker1"' },
            { foremanId: 'foremanC', content: '大規模', confirmedWorkerIds: '[1, "", null, "worker1"]' },
        ];
        const r = await getDay();
        expect([r.status, offersByUser(r.body.members)]).toEqual([200, { foremanA: ['large:foreman:1500'], worker1: ['large:member:200'] }]);
    });

    it('金額は「その日付に有効な金額」の、その人の区分のほう（適用開始日の前の日・当日で変わる。今日の金額ではない）', async () => {
        freezeNow('2026-10-05T03:00:00.000Z'); // 見ているのは 10/5（10/1 からの新しい金額が、もう始まっている）
        const on = async (date: string) => {
            const { body } = await getDay(date);
            return [(body.items ?? []).map((i) => [i.id, i.foremanAmount, i.memberAmount]), offersByUser(body.members)];
        };
        expect(await on(DAY_BEFORE)).toEqual([[['large', 1500, 200]], { foremanA: ['large:foreman:1500'], worker1: ['large:member:200'], foremanB: ['large:member:200'], partner1: [] }]);
        expect(await on(DAY_AFTER)).toEqual([[['large', 2000, 300]], { foremanA: ['large:foreman:2000'], worker1: ['large:member:300'], foremanB: ['large:member:300'], partner1: [] }]);
    });

    it('手当が始まる前の日付（いちばん古い適用開始日より前）では、その手当を出さない（対象の現場の手配に入っていても）。始まりの日の当日からは出る', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([dayRow()]);
        const before = await getDay(BEFORE_START);
        // ボタンは出さないが、班の人と、付いている記録は返す（記録は取り消せる）
        expect([before.status, before.body.items, before.body.monthClosed, offersByUser(before.body.members), canRemoveById(before.body.members)])
            .toEqual([200, [], false, { foremanA: [], worker1: [], foremanB: [], partner1: [] }, { r1: true }]);

        const start = await getDay(START_DAY);
        expect(start.body.items).toEqual([
            { id: 'large', name: '大規模手当', description: '大規模の現場に入った日', foremanAmount: 1500, memberAmount: 200 },
        ]);
        expect(offersByUser(start.body.members).worker1).toEqual(['large:member:200']);

        // 始まりの日は、金額の行の並びによらず、いちばん古い適用開始日
        mock(prisma.allowanceRate.findMany).mockResolvedValue(rateRows().reverse());
        expect([(await getDay(BEFORE_START)).body.items, (await getDay(START_DAY)).body.items?.map((i) => i.id)]).toEqual([[], ['large']]);
    });

    it('始まりの日は手当ごとに見る（もう始まっている手当だけを出す）。金額の行が1つも無い手当は出さない', async () => {
        mock(prisma.allowanceItem.findMany).mockResolvedValue([
            { id: 'late', name: 'あとから始まる手当', description: null, constructionContent: '大規模' },
            { id: 'norate', name: '金額のない手当', description: null, constructionContent: '大規模' },
            { id: 'large', name: '大規模手当', description: null, constructionContent: '大規模' },
        ]);
        mock(prisma.allowanceRate.findMany).mockResolvedValue([
            ...rateRows(),
            { id: 'rateLate', itemId: 'late', foremanAmount: 700, memberAmount: 70, effectiveFrom: utc0('2026-09-15'), createdAt: new Date('2026-09-10T01:00:00.000Z') },
        ]);
        const on = async (date: string) => {
            const { body } = await getDay(date);
            return [(body.items ?? []).map((i) => [i.id, i.foremanAmount, i.memberAmount]), offersByUser(body.members).worker1];
        };
        expect(await on('2026-09-14')).toEqual([[['large', 1500, 200]], ['large:member:200']]);
        expect(await on('2026-09-15')).toEqual([[['late', 700, 70], ['large', 1500, 200]], ['late:member:70', 'large:member:200']]);

        mock(prisma.allowanceRate.findMany).mockResolvedValue([]);
        const none = await getDay();
        expect([none.status, none.body.items, offersByUser(none.body.members).worker1]).toEqual([200, [], []]);
    });

    it('締めた月は、monthClosed: true で、全員の offers が空・items も空（新しく付けられない）。付いている記録は返すが、canRemove は全部 false', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            dayRow({ id: 'r1' }),                                                                              // 職長A が、作業員1 に付けた
            dayRow({ id: 'r2', userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'pending' }),     // 職長A が、自分に付けた（確認待ち）
        ]);
        closedMonths = ['2026-09'];
        for (const login of [{ id: 'foremanA', role: 'foreman2' }, { id: 'manager1', role: 'manager' }, { id: 'admin1', role: 'admin' }]) {
            loginAs(login);
            const r = await getDay();
            expect([login.role, r.status, r.body.monthClosed, r.body.items, offersByUser(r.body.members), canRemoveById(r.body.members)])
                .toEqual([login.role, 200, true, [], { foremanA: [], worker1: [], foremanB: [], partner1: [] }, { r1: false, r2: false }]);
        }
        // 聞くのは、その日付の月
        expect(argOf(prisma.allowanceMonthClose.findMany)).toEqual({ where: { month: { in: ['2026-09'] } }, select: { month: true } });

        // 締めていない月（同じ記録・同じ人）なら、ボタンが出て、記録も取り消せる
        const open = await getDay(DAY_AFTER);
        expect([open.body.monthClosed, open.body.items?.map((i) => i.id), offersByUser(open.body.members).worker1, canRemoveById(open.body.members)])
            .toEqual([false, ['large'], ['large:member:300'], { r1: true, r2: true }]);
    });
});

describe('GET /api/allowances/day: 班の人と、その日の記録（members[].records）', () => {
    it('記録は「班の全員・その日（UTC 0時の印）」で読む。手当の種類では絞らない。班の全員 = 職長本人と、その職長の手配の手配確定メンバーのうち、在籍の人', async () => {
        assignments = [assign('foremanA', '大規模', ['worker1', 'gone1']), assign('foremanA', '改修', ['partner1', 'worker1']), assign('foremanC', '大規模', ['worker2'])];
        const r = await getDay();
        expect(r.status).toBe(200);
        // 対象でない現場の人も、班の人として返す。ほかの職長の班の人・在籍でない人は返さない
        expect(Object.keys(byUser(r.body.members)).sort()).toEqual(['foremanA', 'partner1', 'worker1']);

        const userQuery = argOf<{ where: { id: { in: string[] }; isActive: boolean } }>(prisma.user.findMany);
        expect({ ...userQuery.where, id: { in: [...userQuery.where.id.in].sort() } }).toEqual({ id: { in: ['foremanA', 'gone1', 'partner1', 'worker1'] }, isActive: true });

        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        const query = argOf<{ where: { userId: { in: string[] }; date: Date }; select: unknown }>(prisma.allowanceRecord.findMany);
        expect({ ...query.where, userId: { in: [...query.where.userId.in].sort() } }).toEqual({ userId: { in: ['foremanA', 'partner1', 'worker1'] }, date: utc0(DAY) });
        expect(query.select).toMatchObject({
            id: true, userId: true, itemId: true, itemName: true, payRole: true, amount: true, status: true, createdBy: true, createdByName: true,
        });
    });

    it('使っていない手当・その日のボタンに無い手当の記録も返す。名前・金額・「職長／職長以外」は記録の写し（今の手当の名前・金額・今の手配の区分ではない）', async () => {
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            // 名前を変える前・金額を変える前に付けた記録
            dayRow({ id: 'a', itemName: '大規模手当（前の名前）', amount: 150 }),
            // 使っていない手当の記録
            dayRow({ id: 'b', itemId: 'old', itemName: '夜間手当（旧）', amount: 400 }),
            // 職長B に「職長」で付いている記録（今の手配では、この画面で付けると「職長以外」）
            dayRow({ id: 'c', userId: 'foremanB', payRole: 'foreman', amount: 1500, status: 'pending', createdBy: 'foremanB', createdByName: '職長B' }),
        ]);
        const r = await getDay();
        const members = byUser(r.body.members);
        expect(r.body.items?.map((i) => [i.id, i.name, i.memberAmount])).toEqual([['large', '大規模手当', 200]]);
        expect(members.worker1.records.map((x) => [x.id, x.itemId, x.itemName, x.payRole, x.amount])).toEqual([
            ['a', 'large', '大規模手当（前の名前）', 'member', 150],
            ['b', 'old', '夜間手当（旧）', 'member', 400],
        ]);
        expect([members.foremanB.offers, members.foremanB.records.map((x) => [x.id, x.payRole, x.amount, x.status, x.canRemove])])
            .toEqual([[{ itemId: 'large', payRole: 'member', amount: 200 }], [['c', 'foreman', 1500, 'pending', false]]]);
    });

    it("記録の payRole・status は、決まった値にそろえて返す（'foreman' 以外は member、'pending' 以外は confirmed）", async () => {
        const row = (id: string, payRole: string | null, status: string | null) => dayRow({ id, userId: 'foremanA', payRole, status });
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            row('a', 'foreman', 'pending'), row('b', 'member', 'confirmed'), row('c', 'FOREMAN', 'PENDING'), row('d', '', ''), row('e', 'leader', 'approved'), row('f', null, null),
        ]);
        const records = byUser((await getDay()).body.members).foremanA.records;
        expect(Object.fromEntries(records.map((x) => [x.id, [x.payRole, x.status, x.canRemove]]))).toEqual({
            a: ['foreman', 'pending', true],
            b: ['member', 'confirmed', false],
            // 知らない値は「確定」として扱うので、自分の分は取り消せない
            c: ['member', 'confirmed', false],
            d: ['member', 'confirmed', false],
            e: ['member', 'confirmed', false],
            f: ['member', 'confirmed', false],
        });
    });

    it('canRemove は、操作している人で変わる（職長: 自分が付けた他の人の分と、自分の確認待ちだけ／管理者・マネージャー: 他の人の分はどれでも）', async () => {
        const row = (id: string, userId: string, itemId: string, status: string, createdBy: string) =>
            dayRow({ id, userId, itemId, status, createdBy, createdByName: `${createdBy}の名前` });
        mock(prisma.allowanceRecord.findMany).mockResolvedValue([
            row('mine', 'worker1', 'large', 'confirmed', 'foremanA'),            // 職長A が、作業員1 に付けた
            row('admins', 'worker1', 'old', 'confirmed', 'admin1'),              // 管理者が、作業員1 に付けた
            row('others', 'foremanB', 'large', 'confirmed', 'foremanB'),         // 職長B が自分の班で付けて、認められた
            row('self-pending', 'foremanA', 'large', 'pending', 'foremanA'),     // 職長A が、自分に付けた（確認待ち）
            row('self-confirmed', 'foremanA', 'old', 'confirmed', 'foremanA'),   // 職長A が自分に付けて、認められた
            row('self-by-admin', 'foremanA', 'reform', 'confirmed', 'admin1'),   // 管理者が、職長A に付けた
        ]);
        const canRemoveAs = async (login: { id: string; role: string }) => {
            loginAs(login);
            const r = await getDay();
            expect(r.status).toBe(200);
            return canRemoveById(r.body.members);
        };
        expect(await canRemoveAs({ id: 'foremanA', role: 'foreman2' })).toEqual({
            mine: true, admins: false, others: false, 'self-pending': true, 'self-confirmed': false, 'self-by-admin': false,
        });
        for (const login of [{ id: 'admin1', role: 'admin' }, { id: 'manager1', role: 'manager' }]) {
            expect(await canRemoveAs(login)).toEqual({
                mine: true, admins: true, others: true, 'self-pending': true, 'self-confirmed': true, 'self-by-admin': true,
            });
        }
        // 付けた人の ID と名前は、記録のまま返す
        loginAs({ id: 'foremanA', role: 'foreman2' });
        const records = ((await getDay()).body.members ?? []).flatMap((m) => m.records);
        expect(Object.fromEntries(records.map((x) => [x.id, [x.createdBy, x.createdByName]]))).toMatchObject({
            mine: ['foremanA', 'foremanAの名前'], admins: ['admin1', 'admin1の名前'], others: ['foremanB', 'foremanBの名前'],
        });
    });

    it('班に人がいない（職長も在籍でない）ときは、members も items も空。記録は読まない', async () => {
        users = [...allUsers(), { id: 'goneForeman', displayName: '在籍でない職長', role: 'FOREMAN2', isActive: false }];
        assignments = [assign('goneForeman', '大規模', ['gone1'])];
        loginAs({ id: 'admin1', role: 'admin', name: '管理者' });
        const r = await getDay(DAY, 'goneForeman');
        expect([r.status, r.body.members, r.body.items, r.body.monthClosed]).toEqual([200, [], [], false]);
        expect(prisma.allowanceRecord.findMany).not.toHaveBeenCalled();
    });
});
