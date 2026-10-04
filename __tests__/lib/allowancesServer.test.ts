/**
 * @jest-environment node
 *
 * lib/allowancesServer.ts（手当: DB を読む・書く側の共通部品）のテスト。
 *
 * @/lib/prisma は jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * だから「絞り込みが正しいか」「何を書いたか」は、返ってきた値ではなく、DB の関数に渡した引数で確かめる。
 *
 * いちばん守りたい約束:
 *   - 書く関数（足す・取り消す・認める・締める・締めを外す・金額を変える・予約を取り消す）は、どれも
 *     「トランザクションを開く（決まった設定つき）→ 鍵を取る → 締めてあるかを読む → 書く → 同じトランザクションで履歴を書く」の順
 *   - 締めた月には、足せない・取り消せない・認められない。締めた月にかかる金額の変更もできない
 *   - 金額は「記録の日付に有効な金額」の、職長／職長以外のほう。自分に付けた分は確認待ち
 *   - 職長／職長以外は、呼ぶ側がその日の手配から決めた区分（targetPayRole）のとおりに入れる
 *   - 手当が始まる前の日付（いちばん古い適用開始日より前）には付けない（入れない・手配と見比べるときも見ない）
 *   - 金額をさかのぼって変えたら、適用開始日からあとの記録も、同じトランザクションの中で新しい金額に合わせる
 *   - 履歴は、実際に入った・消えた・変わった記録だけ
 *   - 手配の日時は日本時間で数える（その日＝UTC 前日15時から24時間）
 *
 * トランザクションの中かどうかの見分け方:
 *   jest.setup.ts の $transaction は、同じ prisma をそのまま callback に渡す。それだと
 *   「トランザクションの中の読み書きが、tx を通っているか（prisma を直接使っていないか）」が見分けられない。
 *   このファイルでは、tx として「prisma と同じモック関数を持つ、別のオブジェクト」を渡す。
 *   どちらから呼ばれたか（jest.fn の mock.contexts）と、呼ばれた順番（mock.invocationCallOrder）は、dbCalls() で一覧にできる。
 *
 * 日付: 決まった日（主に 2026年8〜10月）を使う。「今日」を引数（todayKey）で渡せる関数は、引数で渡す。
 * 時計を固定する（freezeNow）のは、次のテストだけ（本物の時計には頼らない）:
 *   - 「今日」の既定値が日本時間であることを確かめるテスト
 *   - 関数の中で「今日」「今の時刻」を決めるもの（金額を変える・予約を取り消す・認めた日時）のテスト
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dayOffersForCrew, resolveAllowanceRateAt } from '@/lib/allowances';
import * as evaluationPointsServer from '@/lib/evaluationPointsServer';
import {
    ALLOWANCE_SETTING_ID,
    ALLOWANCE_TX_OPTIONS,
    actorOf,
    addAllowanceRate,
    addAllowanceRecords,
    cancelAllowanceRate,
    closeAllowanceMonth,
    confirmAllowanceRecords,
    getAllowanceSetting,
    getAttendanceMembers,
    isAllowanceMonthClosed,
    loadAllowanceCrosscheck,
    loadAllowanceRatesByItemId,
    loadClosedMonths,
    loadDayAssignments,
    loadUnclosedPastMonths,
    lockAllowanceWrites,
    removeAllowanceRecord,
    reopenAllowanceMonth,
    resolveAllowanceAccessMode,
    toAllowanceRateLike,
    toggleAllowanceForDay,
    type AddAllowanceParams,
    type AddAllowanceRateInput,
    type AllowanceActor,
    type AllowanceRecordRow,
    type ToggleAllowanceParams,
} from '@/lib/allowancesServer';

// ================================================================ 土台

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);
/** @db.Date の Date（UTC 0時の印）→ 'YYYY-MM-DD'（見比べやすくするため） */
const keyOf = (date: unknown) => (date as Date).toISOString().slice(0, 10);

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

/** 呼ばれたときの this → 'prisma.user'・'tx.allowanceRecord' などの名前 */
const ownerNames = new Map<unknown, string>([[prismaMock, 'prisma'], [txMock, 'tx']]);
for (const [name, value] of Object.entries(prismaMock)) {
    if (!isModel(value)) continue;
    ownerNames.set(value, `prisma.${name}`);
    ownerNames.set(txMock[name], `tx.${name}`);
}

/**
 * これまでに呼ばれた DB の操作を、呼ばれた順に並べた名前の一覧。
 *   例: ['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceMonthClose.findMany', ...]
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

/** dbCalls() から、同じ名前の2回目以降を除いたもの（「どの操作が、どの順に始まったか」だけを見るとき用） */
const dbCallOrder = (): string[] => Array.from(new Set(dbCalls()));

/**
 * $executeRaw（タグ付きテンプレート）に渡した SQL を、1つの文字にしたもの（呼ばれた回数ぶん）。
 * タグ付きテンプレートは「SQL の文字の配列」と「埋め込む値」に分けて渡すので、値があれば元の場所に戻してつなぐ。
 */
const executedSqls = (): string[] =>
    mock(prisma.$executeRaw).mock.calls.map((args: unknown[]) => {
        const [strings, ...values] = args as [string[], ...unknown[]];
        return strings.map((s, i) => s + (i < values.length ? String(values[i]) : '')).join('');
    });

/** どの表にも、何も書いていないこと（作る・直す・消す の呼び出しが1つも無い。鍵と読むだけの操作は数えない） */
const noWrites = () =>
    expect(dbCalls().filter((name) => /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$/.test(name))).toEqual([]);

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

// ---------------------------------------------------------------- 操作する人・手当・金額・記録

/** 名前は、わざと id と違う値にする（id と名前の取り違えを見つけるため） */
const ADMIN: AllowanceActor = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER: AllowanceActor = { id: 'manager1', role: 'manager', name: 'マネージャー1' };
const FOREMAN_A: AllowanceActor = { id: 'foremanA', role: 'foreman2', name: '職長A' };
const WORKER: AllowanceActor = { id: 'worker1', role: 'worker', name: '作業員1' };

const ITEM = { id: 'large', name: '大規模手当' };

/**
 * 大規模手当の金額: 9/1 から 職長 1,500円・職長以外 200円 ／ 10/1 から 職長 2,000円・職長以外 300円。
 * いちばん古い適用開始日（9/1）が「手当の始まりの日」。それより前の日付には、有効な金額が無い（付けられない）。
 */
const RATE_ROWS = [
    { id: 'rate1', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-08-20T01:00:00.000Z') },
    { id: 'rate2', itemId: 'large', foremanAmount: 2000, memberAmount: 300, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-09-20T01:00:00.000Z') },
];
/** RATE_ROWS を、決まりの関数に渡す形（適用開始日は YYYY-MM-DD・入れた日時は ISO 文字列）にしたもの */
const RATE_LIKES = [
    { id: 'rate1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01', createdAt: '2026-08-20T01:00:00.000Z' },
    { id: 'rate2', foremanAmount: 2000, memberAmount: 300, effectiveFrom: '2026-10-01', createdAt: '2026-09-20T01:00:00.000Z' },
];

/** すでにある記録（findFirst・findUnique が返す行＝全部の列）。既定は「職長A が、作業員1 に付けた 9/30 の記録」 */
const recordRow = (over: Partial<AllowanceRecordRow> = {}): AllowanceRecordRow => ({
    id: 'r1', userId: 'worker1', date: utc0('2026-09-30'), itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200,
    rateId: 'rate1', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null,
    createdBy: 'foremanA', createdByName: '職長A', confirmedBy: null, confirmedByName: null, confirmedAt: null,
    createdAt: new Date('2026-09-30T09:00:00.000Z'), updatedAt: new Date('2026-09-30T09:00:00.000Z'), ...over,
});

/** 入った行（createManyAndReturn が返す、全部の列）。渡した data に、DB が付ける列（id・日時など）を足したもの */
const insertedRow = (data: Record<string, unknown>, id: string) => ({
    id, confirmedBy: null, confirmedByName: null, confirmedAt: null,
    createdAt: new Date('2026-10-02T03:00:00.000Z'), updatedAt: new Date('2026-10-02T03:00:00.000Z'), ...data,
});

/** createManyAndReturn に渡した data（call 回目の呼び出し。既定は最初） */
const insertedData = (call = 0) =>
    (mock(prisma.allowanceRecord.createManyAndReturn).mock.calls[call][0] as { data: Record<string, unknown>[] }).data;

/**
 * 締めてある月を決める。モックは where を見ないので、ここで「頼まれた月のうち、締めてある月」だけを返すようにする
 * （本物の DB と同じ答えになる）。条件は、手当のコードが使う3通り:
 *   month: { in: [...] }（その月たち）／ month: { gte: 'YYYY-MM' }（その月からあと）／ 条件なし（全部）
 */
const closeMonths = (...months: string[]) =>
    mock(prisma.allowanceMonthClose.findMany).mockImplementation(async (args?: { where?: { month?: { in?: string[]; gte?: string } } }) => {
        const condition = args?.where?.month;
        return months
            .filter((m) => (condition?.in ? condition.in.includes(m) : true) && (condition?.gte ? m >= condition.gte : true))
            .map((month) => ({ month }));
    });

/** 締めた月の行を作ったときに、DB が付ける日時 */
const CLOSED_AT = new Date('2026-10-04T01:23:45.000Z');

/** $transaction に渡した2つめの引数（トランザクションの設定。呼ばれた回数ぶん） */
const transactionOptions = (): unknown[] => mock(prisma.$transaction).mock.calls.map((args: unknown[]) => args[1]);

beforeEach(() => {
    jest.clearAllMocks();
    // このファイルでは、トランザクションの中に「prisma とは別の tx」を渡す（ファイルの先頭の説明を参照）
    mock(prisma.$transaction).mockImplementation(async (callback: (client: Prisma.TransactionClient) => unknown) => callback(tx));

    closeMonths();                                                      // どの月も締めていない
    mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue(null);
    mock(prisma.allowanceMonthClose.create).mockResolvedValue({ closedAt: CLOSED_AT });
    mock(prisma.allowanceMonthClose.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.allowanceItem.findUnique).mockResolvedValue({ id: 'large' });
    mock(prisma.allowanceRate.findMany).mockResolvedValue(RATE_ROWS);
    mock(prisma.allowanceRate.findUnique).mockResolvedValue(null);
    // create は「足した行（読む列）」を返すようにする。id は DB が付ける
    mock(prisma.allowanceRate.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rate-new', ...data }));
    mock(prisma.allowanceRate.delete).mockResolvedValue({});
    mock(prisma.allowanceRecord.findFirst).mockResolvedValue(null);     // まだ付いていない
    mock(prisma.allowanceRecord.findUnique).mockResolvedValue(null);
    mock(prisma.allowanceRecord.findMany).mockResolvedValue([]);
    mock(prisma.allowanceRecord.groupBy).mockResolvedValue([]);
    // createManyAndReturn は「入った行の配列（全部の列）」を返すようにする
    mock(prisma.allowanceRecord.createManyAndReturn).mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) =>
        data.map((d, i) => insertedRow(d, `new-${i + 1}`)));
    // updateMany・deleteMany は { count } を返すようにする（jest.fn() のままだと undefined が返る）。
    // updateMany は「条件の id の数だけ変わった」ことにする（id: { in: [...] } で頼まれたら、その件数）
    mock(prisma.allowanceRecord.updateMany).mockImplementation(async ({ where }: { where: { id?: string | { in: string[] } } }) =>
        ({ count: typeof where.id === 'object' ? where.id.in.length : 1 }));
    mock(prisma.allowanceRecord.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.allowanceLog.create).mockResolvedValue({});
    mock(prisma.allowanceLog.createMany).mockResolvedValue({ count: 1 });
    mock(prisma.allowanceSetting.findUnique).mockResolvedValue(null);
    mock(prisma.projectAssignment.findMany).mockResolvedValue([]);
    mock(prisma.user.findMany).mockResolvedValue([]);
    mock(prisma.attendanceRecord.findMany).mockResolvedValue([]);
});

afterEach(() => {
    jest.useRealTimers();
});

// ================================================================ 書き込みの鍵・締め

describe('書き込みの鍵（lockAllowanceWrites）', () => {
    it('$executeRaw をタグ付きテンプレートで1回だけ呼ぶ。SQL は pg_advisory_xact_lock（トランザクションが終わると外れる鍵）で、鍵の名前は dandolink-allowance', async () => {
        await lockAllowanceWrites(tx);

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        // タグ付きテンプレートで呼ぶと、1つめの引数は「SQL の文字の配列（raw つき）」になる
        const strings = mock(prisma.$executeRaw).mock.calls[0][0] as string[] & { raw?: unknown };
        expect(Array.isArray(strings)).toBe(true);
        expect(Array.isArray(strings.raw)).toBe(true);
        const [sql] = executedSqls();
        expect(sql).toContain('pg_advisory_xact_lock');
        expect(sql).toContain('dandolink-allowance');
        // 渡された tx で呼ぶ。ほかの DB の操作はしない
        expect(dbCalls()).toEqual(['tx.$executeRaw']);
    });
});

describe('締めた月を読む（loadClosedMonths・isAllowanceMonthClosed）', () => {
    it('重なりを除いた月を allowanceMonthClose.findMany に渡し、返ってきた月を Set で返す', async () => {
        closeMonths('2026-08', '2026-10');
        const closed = await loadClosedMonths(prisma, ['2026-09', '2026-10', '2026-09', '2026-08', '2026-10']);

        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledWith({
            where: { month: { in: ['2026-09', '2026-10', '2026-08'] } },
            select: { month: true },
        });
        expect(closed).toBeInstanceOf(Set);
        expect([...closed].sort()).toEqual(['2026-08', '2026-10']);
    });

    it('どの月も締めていなければ、空の Set', async () => {
        const closed = await loadClosedMonths(prisma, ['2026-09']);
        expect(closed.size).toBe(0);
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(1);
    });

    it('月を1つも渡さなければ、DB を読まずに空の Set を返す', async () => {
        const closed = await loadClosedMonths(prisma, []);
        expect(closed).toBeInstanceOf(Set);
        expect(closed.size).toBe(0);
        expect(dbCalls()).toEqual([]);
    });

    it('渡された db で読む（トランザクションの中なら tx、外なら prisma）', async () => {
        await loadClosedMonths(tx, ['2026-09']);
        await loadClosedMonths(prisma, ['2026-09']);
        expect(dbCalls()).toEqual(['tx.allowanceMonthClose.findMany', 'prisma.allowanceMonthClose.findMany']);
    });

    it('isAllowanceMonthClosed: その月が締めてあれば true、締めていなければ false（その月だけを読む）', async () => {
        closeMonths('2026-08');
        expect(await isAllowanceMonthClosed('2026-08')).toBe(true);
        expect(await isAllowanceMonthClosed('2026-09')).toBe(false);
        expect(mock(prisma.allowanceMonthClose.findMany).mock.calls.map((c) => c[0])).toEqual([
            { where: { month: { in: ['2026-08'] } }, select: { month: true } },
            { where: { month: { in: ['2026-09'] } }, select: { month: true } },
        ]);
    });
});

// ================================================================ 金額の履歴

describe('金額の履歴（loadAllowanceRatesByItemId）', () => {
    it('手当ごとの金額の履歴を、resolveAllowanceRateAt に渡せる形（日付は文字列）で返す', async () => {
        mock(prisma.allowanceRate.findMany).mockResolvedValue([
            { id: 'rate1', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-08-20T01:02:03.456Z') },
            { id: 'rate2', itemId: 'large', foremanAmount: 2000, memberAmount: 300, effectiveFrom: utc0('2026-12-31'), createdAt: new Date('2026-09-20T01:00:00.000Z') },
        ]);
        const map = await loadAllowanceRatesByItemId(['large', 'night', 'large']);

        // 同じ手当を2回渡しても、読むのは1回・ID は1つずつ
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledWith({
            where: { itemId: { in: ['large', 'night'] } },
            select: { id: true, itemId: true, foremanAmount: true, memberAmount: true, effectiveFrom: true, createdAt: true },
        });
        expect(map.get('large')).toEqual([
            // @db.Date の適用開始日（UTC 0時の印）は 'YYYY-MM-DD'、入れた日時は ISO 文字列
            { id: 'rate1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01', createdAt: '2026-08-20T01:02:03.456Z' },
            { id: 'rate2', foremanAmount: 2000, memberAmount: 300, effectiveFrom: '2026-12-31', createdAt: '2026-09-20T01:00:00.000Z' },
        ]);
        // 金額の行が無い手当は、空の配列で入る
        expect(map.get('night')).toEqual([]);
        expect([...map.keys()].sort()).toEqual(['large', 'night']);
        // そのまま resolveAllowanceRateAt に渡せる（適用開始日の当日から、新しい金額）
        expect(resolveAllowanceRateAt(map.get('large') ?? [], '2026-12-30')?.id).toBe('rate1');
        expect(resolveAllowanceRateAt(map.get('large') ?? [], '2026-12-31')?.id).toBe('rate2');
    });

    it('手当を1つも渡さなければ、DB を読まずに空の Map を返す', async () => {
        const map = await loadAllowanceRatesByItemId([]);
        expect(map.size).toBe(0);
        expect(dbCalls()).toEqual([]);
    });

    it('db を渡さなければ prisma で、渡せばその db（トランザクションの中なら tx）で読む', async () => {
        await loadAllowanceRatesByItemId(['large']);
        await loadAllowanceRatesByItemId(['large'], tx);
        expect(dbCalls()).toEqual(['prisma.allowanceRate.findMany', 'tx.allowanceRate.findMany']);
    });

    it('toAllowanceRateLike: 金額の行を、決まりの関数に渡す形にする（適用開始日は YYYY-MM-DD・入れた日時は ISO 文字列。ほかの列は写さない）', () => {
        const row = {
            id: 'rate1', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'),
            createdBy: 'admin1', createdByName: '管理者1', createdAt: new Date('2026-08-20T01:02:03.456Z'),
        };
        const like = toAllowanceRateLike(row);
        expect(like).toEqual({ id: 'rate1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-09-01', createdAt: '2026-08-20T01:02:03.456Z' });
        expect(Object.keys(like).sort()).toEqual(['createdAt', 'effectiveFrom', 'foremanAmount', 'id', 'memberAmount']);
    });
});

// ================================================================ その日の手配

describe('その日の手配（loadDayAssignments）', () => {
    /** 手配の行（読む列だけ）。既定は「職長A の、9/10 の大規模の現場（作業員1）」 */
    const row = (over: Record<string, unknown> = {}) => ({
        assignedEmployeeId: 'foremanA', date: new Date('2026-09-09T15:00:00.000Z'), confirmedWorkerIds: '["worker1"]',
        projectMasterId: 'site1', projectMaster: { title: '大規模の現場', constructionContent: '大規模' }, ...over,
    });
    const rowsAre = (rows: unknown[]) => mock(prisma.projectAssignment.findMany).mockResolvedValue(rows);
    /** その呼び出しが、手配（projectAssignment）の findMany に渡した where */
    const assignmentWhereOf = async (run: () => Promise<unknown>) => {
        mock(prisma.projectAssignment.findMany).mockClear();
        await run();
        expect(prisma.projectAssignment.findMany).toHaveBeenCalledTimes(1);
        return mock(prisma.projectAssignment.findMany).mock.calls[0][0].where as Record<string, unknown>;
    };

    it('手配の取り方は、getAttendanceMembers（「出勤簿入力」に並ぶ人の決まり）と同じ。違うのは「職長で絞らない」ことだけ（月をまたぐ日・うるう日・年をまたぐ日でも）', async () => {
        for (const date of ['2026-09-10', '2026-11-01', '2026-12-31', '2028-02-29', '2027-01-01']) {
            const fromMembers = await assignmentWhereOf(() => getAttendanceMembers('foremanA', date));
            const fromDay = await assignmentWhereOf(() => loadDayAssignments(date));
            // 職長の条件を足せば、まったく同じ where になる
            expect({ date, where: { ...fromDay, assignedEmployeeId: 'foremanA' } }).toEqual({ date, where: fromMembers });
            expect(Object.keys(fromDay).sort()).toEqual(['date', 'isBackfilled']);
        }
    });

    it('日付の境界: 2026-09-10 を指定したら、2026-09-09T15:00Z 以上・2026-09-10T15:00Z 未満（日本時間のその日）の、過去データ取込でない配置を、全部の職長ぶん読む', async () => {
        await loadDayAssignments('2026-09-10');
        expect(prisma.projectAssignment.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.projectAssignment.findMany).toHaveBeenCalledWith({
            where: { date: { gte: new Date('2026-09-09T15:00:00.000Z'), lt: new Date('2026-09-10T15:00:00.000Z') }, isBackfilled: false },
            select: {
                assignedEmployeeId: true, date: true, confirmedWorkerIds: true, projectMasterId: true,
                projectMaster: { select: { title: true, constructionContent: true } },
            },
        });
        // 読むだけ（トランザクションも鍵も使わない）
        expect(dbCalls()).toEqual(['prisma.projectAssignment.findMany']);
    });

    it('手配の行を、判定に使う形（職長・日本時間の日付・手配確定のメンバー・工事内容）にして、読んだ順に、ほかの職長の分もそのまま返す', async () => {
        rowsAre([
            row(),
            row({ assignedEmployeeId: 'foremanB', confirmedWorkerIds: '["worker2","foremanA"]', projectMasterId: 'site2', projectMaster: { title: '改修の現場', constructionContent: '改修' } }),
            row({ confirmedWorkerIds: '["worker3","worker1"]', projectMasterId: 'site3', projectMaster: { title: '別の大規模の現場', constructionContent: '大規模' } }),
        ]);
        expect(await loadDayAssignments('2026-09-10')).toEqual([
            { foremanId: 'foremanA', dateKey: '2026-09-10', workerIds: ['worker1'], content: '大規模' },
            { foremanId: 'foremanB', dateKey: '2026-09-10', workerIds: ['worker2', 'foremanA'], content: '改修' },
            { foremanId: 'foremanA', dateKey: '2026-09-10', workerIds: ['worker3', 'worker1'], content: '大規模' },
        ]);
    });

    it('日付は、手配の日時（日本時間 0時 = UTC 前日15時）を、日本時間の日付にしたもの（UTC の日付をそのまま使うと1日前になる）', async () => {
        rowsAre([
            row({ date: new Date('2026-09-09T15:00:00.000Z') }),     // 日本時間 9/10 0:00
            row({ date: new Date('2026-09-10T14:59:59.999Z') }),     // 日本時間 9/10 23:59
            row({ date: new Date('2026-08-31T15:00:00.000Z') }),     // 日本時間 9/1 0:00（月をまたぐ）
            row({ date: new Date('2026-12-31T15:00:00.000Z') }),     // 日本時間 2027/1/1 0:00（年をまたぐ）
        ]);
        expect((await loadDayAssignments('2026-09-10')).map((a) => a.dateKey)).toEqual(['2026-09-10', '2026-09-10', '2026-09-01', '2027-01-01']);
    });

    it("手配確定のメンバー: null・空文字・配列でない JSON（'null'・'{}'・'5'・'\"abc\"'）はメンバーなし。配列の中の、空の ID・文字列でない値は捨てる", async () => {
        const values: (string | null)[] = [null, '', 'null', '{}', '5', '"abc"', 'true', '{"0":"worker1","length":1}', '[]', '["","worker1",null,5,true,["worker2"],{"id":"worker3"},"worker4"]'];
        rowsAre(values.map((confirmedWorkerIds) => row({ confirmedWorkerIds })));
        expect((await loadDayAssignments('2026-09-10')).map((a) => a.workerIds)).toEqual([
            [], [], [], [], [], [], [], [], [], ['worker1', 'worker4'],
        ]);
    });

    it('工事内容: 旧い値は今の名前に寄せる・前後の空白は取る。未設定（null・空・空白だけ）と、案件が読めない配置（projectMaster が無い）は null', async () => {
        const contents = ['大規模', 'large_scale', ' 大規模 ', 'renovation', '改修', null, '', '   '];
        rowsAre([
            ...contents.map((constructionContent) => row({ projectMaster: { title: '現場', constructionContent } })),
            row({ projectMaster: null }),
        ]);
        expect((await loadDayAssignments('2026-09-10')).map((a) => a.content)).toEqual([
            '大規模', '大規模', '大規模', '改修', '改修', null, null, null, null,
        ]);
    });

    it('手配が無い日は、空の配列', async () => {
        expect(await loadDayAssignments('2026-09-10')).toEqual([]);
    });

    it('形の違う・実在しない日付は例外にする（黙って空の配列を返さない）。DB も読まない', async () => {
        for (const bad of ['2026-02-30', '2026/09/10', '2026-9-10', '']) {
            await expect(loadDayAssignments(bad)).rejects.toThrow('日付の形が違います');
        }
        expect(dbCalls()).toEqual([]);
    });

    it('答えを、そのまま dayOffersForCrew（その班の画面で、だれに・どの区分で付けられるか）に渡せる', async () => {
        rowsAre([
            // 職長A: 大規模の現場（作業員1・職長B）と、改修の現場（作業員2）
            row({ confirmedWorkerIds: '["worker1","foremanB"]', projectMaster: { title: '大規模の現場', constructionContent: 'large_scale' } }),
            row({ confirmedWorkerIds: '["worker2"]', projectMasterId: 'site2', projectMaster: { title: '改修の現場', constructionContent: '改修' } }),
            // 職長B: 同じ日に、自分の班でも大規模の現場（作業員3）
            row({ assignedEmployeeId: 'foremanB', confirmedWorkerIds: '["worker3"]', projectMasterId: 'site3', projectMaster: { title: '別の大規模の現場', constructionContent: '大規模' } }),
        ]);
        const dayAssignments = await loadDayAssignments('2026-09-10');

        // 職長A の画面: 職長A の大規模の現場に入っている人だけ。職長B は、自分の班（大規模）の職長でもあるので「職長」
        expect(Object.fromEntries(dayOffersForCrew('大規模', dayAssignments, 'foremanA'))).toEqual({ foremanA: 'foreman', worker1: 'member', foremanB: 'foreman' });
        // 職長B の画面: 職長B と作業員3 だけ（職長A の班の人には付けられない）
        expect(Object.fromEntries(dayOffersForCrew('大規模', dayAssignments, 'foremanB'))).toEqual({ foremanB: 'foreman', worker3: 'member' });
    });
});

// ================================================================ 公開の設定

describe('公開の設定（getAllowanceSetting・resolveAllowanceAccessMode）', () => {
    const settingRow = (showToMembers: unknown, memberNotice: unknown = null) =>
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers, memberNotice });

    it("getAllowanceSetting: id が 'default' の1行を読む。行が無ければ「見せない・注意書きなし」", async () => {
        mock(prisma.allowanceSetting.findUnique).mockResolvedValue(null);
        expect(await getAllowanceSetting()).toEqual({ showToMembers: false, memberNotice: null });

        expect(ALLOWANCE_SETTING_ID).toBe('default');
        expect(prisma.allowanceSetting.findUnique).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceSetting.findUnique).toHaveBeenCalledWith({
            where: { id: 'default' },
            select: { showToMembers: true, memberNotice: true },
        });
    });

    it('getAllowanceSetting: 行があれば、その値を返す（showToMembers は true のときだけ true。注意書きが無ければ null）', async () => {
        settingRow(true, '金額は、月を締めるまで変わることがあります');
        expect(await getAllowanceSetting()).toEqual({ showToMembers: true, memberNotice: '金額は、月を締めるまで変わることがあります' });

        settingRow(false, null);
        expect(await getAllowanceSetting()).toEqual({ showToMembers: false, memberNotice: null });

        // true 以外（null・無い・文字・数字）は「見せない」に倒す。注意書きの列が無くても null
        for (const odd of [null, undefined, 'true', 1]) {
            mock(prisma.allowanceSetting.findUnique).mockResolvedValue({ showToMembers: odd });
            const setting = await getAllowanceSetting();
            expect(setting.showToMembers).toBe(false);
            expect(setting.memberNotice).toBeNull();
        }
    });

    it("resolveAllowanceAccessMode: admin・manager は、公開の設定を読まずに 'manager'（大文字のロールでも同じ）", async () => {
        for (const role of ['admin', 'manager', 'ADMIN', 'MANAGER', 'Admin']) {
            expect([role, await resolveAllowanceAccessMode(role)]).toEqual([role, 'manager']);
        }
        expect(prisma.allowanceSetting.findUnique).not.toHaveBeenCalled();
    });

    it("resolveAllowanceAccessMode: worker・foreman1・foreman2 は、公開の設定がオンなら 'member'・オフ（または行が無い）なら 'none'（大文字のロールでも同じ）", async () => {
        for (const role of ['worker', 'foreman1', 'foreman2', 'WORKER', 'FOREMAN1', 'Foreman2']) {
            settingRow(true);
            expect([role, 'オン', await resolveAllowanceAccessMode(role)]).toEqual([role, 'オン', 'member']);
            settingRow(false);
            expect([role, 'オフ', await resolveAllowanceAccessMode(role)]).toEqual([role, 'オフ', 'none']);
            mock(prisma.allowanceSetting.findUnique).mockResolvedValue(null);
            expect([role, '行なし', await resolveAllowanceAccessMode(role)]).toEqual([role, '行なし', 'none']);
        }
    });

    it("resolveAllowanceAccessMode: それ以外のロール・空・null は、公開の設定を読まずに 'none'（公開の設定がオンでも）", async () => {
        settingRow(true);
        for (const role of ['partner', 'partner_member', 'accountant', 'support', 'PARTNER_MEMBER', 'unknown', '', null, undefined]) {
            expect([role, await resolveAllowanceAccessMode(role)]).toEqual([role, 'none']);
        }
        expect(prisma.allowanceSetting.findUnique).not.toHaveBeenCalled();
    });
});

describe('評価ポイントと同じ部品を使う（「出勤簿入力」に並ぶ人の決まりを、2か所に書かない）', () => {
    it('getAttendanceMembers・actorOf は、lib/evaluationPointsServer.ts の関数そのもの', () => {
        expect(getAttendanceMembers).toBe(evaluationPointsServer.getAttendanceMembers);
        expect(actorOf).toBe(evaluationPointsServer.actorOf);
    });
});

// ================================================================ 記録を足す

describe('addAllowanceRecords（記録を足す）', () => {
    /** 管理者1 が、作業員1 の 9/30 に「記録を足す」 */
    const add = (over: Partial<AddAllowanceParams> = {}) => addAllowanceRecords({
        actor: ADMIN, item: ITEM, source: 'manual',
        entries: [{ userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' }],
        ...over,
    });

    it('順番: トランザクションの中で、鍵 → 締めた月を読む → 金額を読む → 記録を入れる → 履歴を書く（どれも1回ずつ・全部 tx で）', async () => {
        const result = await add();
        expect(result.added).toHaveLength(1);
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.$executeRaw',
            'tx.allowanceMonthClose.findMany',
            'tx.allowanceRate.findMany',
            'tx.allowanceRecord.createManyAndReturn',
            'tx.allowanceLog.createMany',
        ]);
        // 読むときの条件: 締めは「記録の日付の月」、金額は「その手当」
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledWith({ where: { month: { in: ['2026-09'] } }, select: { month: true } });
        expect(mock(prisma.allowanceRate.findMany).mock.calls[0][0].where).toEqual({ itemId: { in: ['large'] } });
    });

    it("入れる中身: 日付は UTC 0時の印・名前は渡した手当の名前・自分に付けた分だけ 'pending'・同じ記録があれば入れない（skipDuplicates）", async () => {
        const result = await add({
            source: 'bulk', foremanId: 'foremanA', note: '付け忘れの分',
            entries: [
                { userId: 'foremanA', dateKey: '2026-09-30', payRole: 'foreman' },
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' },
                { userId: 'admin1', dateKey: '2026-09-30', payRole: 'member' }, // 操作している人（管理者1）自身
            ],
        });

        const common = {
            date: utc0('2026-09-30'), itemId: 'large', itemName: '大規模手当', rateId: 'rate1',
            source: 'bulk', foremanId: 'foremanA', note: '付け忘れの分', createdBy: 'admin1', createdByName: '管理者1',
        };
        expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledWith({
            data: [
                { ...common, userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'confirmed' },
                { ...common, userId: 'worker1', payRole: 'member', amount: 200, status: 'confirmed' },
                { ...common, userId: 'admin1', payRole: 'member', amount: 200, status: 'pending' },
            ],
            skipDuplicates: true,
        });
        // 返すのは、実際に入った行（createManyAndReturn が返した行）と、入れなかった件数（締めた月・金額なし・すでに記録があった）
        expect(result.added.map((r) => [r.id, r.userId, r.status])).toEqual([
            ['new-1', 'foremanA', 'confirmed'], ['new-2', 'worker1', 'confirmed'], ['new-3', 'admin1', 'pending'],
        ]);
        expect([result.closedCount, result.noRateCount, result.duplicateCount]).toEqual([0, 0, 0]);
        expect(Object.keys(result).sort()).toEqual(['added', 'closedCount', 'duplicateCount', 'noRateCount']);
        // 手当の表は読まない（名前は、呼ぶ側が渡したものを写す）
        expect(dbCalls().filter((name) => name.includes('allowanceItem'))).toEqual([]);
    });

    it('foremanId・note を渡さなければ null で入る。source は渡した値のまま', async () => {
        for (const source of ['manual', 'bulk', 'attendance'] as const) {
            mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
            await add({ source });
            expect(insertedData()).toEqual([{
                userId: 'worker1', date: utc0('2026-09-30'), itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, rateId: 'rate1',
                status: 'confirmed', source, foremanId: null, note: null, createdBy: 'admin1', createdByName: '管理者1',
            }]);
        }
    });

    it('金額は「記録の日付に有効な金額」（保存した日ではなく、現場に入った日で決まる）の、職長なら職長の金額・職長以外なら職長以外の金額', async () => {
        await add({
            source: 'bulk',
            entries: [
                { userId: 'foremanA', dateKey: '2026-09-01', payRole: 'foreman' }, // 手当の始まりの日（いちばん古い適用開始日の当日）
                { userId: 'worker1', dateKey: '2026-09-01', payRole: 'member' },
                { userId: 'foremanA', dateKey: '2026-09-30', payRole: 'foreman' }, // 金額を変える前の日
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' },
                { userId: 'foremanA', dateKey: '2026-10-01', payRole: 'foreman' }, // 金額を変えた日（適用開始日の当日）
                { userId: 'worker1', dateKey: '2026-10-01', payRole: 'member' },
            ],
        });
        expect(insertedData().map((d) => [d.userId, keyOf(d.date), d.payRole, d.amount, d.rateId])).toEqual([
            ['foremanA', '2026-09-01', 'foreman', 1500, 'rate1'],
            ['worker1', '2026-09-01', 'member', 200, 'rate1'],
            ['foremanA', '2026-09-30', 'foreman', 1500, 'rate1'],
            ['worker1', '2026-09-30', 'member', 200, 'rate1'],
            ['foremanA', '2026-10-01', 'foreman', 2000, 'rate2'],
            ['worker1', '2026-10-01', 'member', 300, 'rate2'],
        ]);
        // 金額は、まとめて1回だけ読む
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledTimes(1);
    });

    it('同じ適用開始日の金額が2行あれば、後から入れた行を使う（DB が返す並びによらない）', async () => {
        const older = { id: 'old', itemId: 'large', foremanAmount: 1000, memberAmount: 100, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-08-20T01:00:00.000Z') };
        const newer = { id: 'new', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-08-25T01:00:00.000Z') };
        for (const rows of [[older, newer], [newer, older]]) {
            mock(prisma.allowanceRate.findMany).mockResolvedValue(rows);
            mock(prisma.allowanceRecord.createManyAndReturn).mockClear();
            await add();
            expect(insertedData()[0]).toMatchObject({ amount: 200, rateId: 'new' });
        }
    });

    it('手当が始まる前の日付（いちばん古い適用開始日より前）の分は入れない（noRateCount に数える）。金額のある日付の分は入れる', async () => {
        // 大規模手当の始まりは 9/1
        const result = await add({
            source: 'bulk',
            entries: [
                { userId: 'worker1', dateKey: '2026-08-31', payRole: 'member' },  // 始まる前の日（最初の金額を、さかのぼって使わない）
                { userId: 'worker1', dateKey: '2026-09-01', payRole: 'member' },  // 始まりの日（当日からは入る）
                { userId: 'foremanA', dateKey: '2026-08-15', payRole: 'foreman' }, // 始まる前の日
                { userId: 'foremanA', dateKey: '2026-09-30', payRole: 'foreman' },
            ],
        });

        expect(insertedData().map((d) => [d.userId, keyOf(d.date), d.amount, d.rateId])).toEqual([
            ['worker1', '2026-09-01', 200, 'rate1'], ['foremanA', '2026-09-30', 1500, 'rate1'],
        ]);
        expect(result.added.map((r) => [r.userId, keyOf(r.date)])).toEqual([['worker1', '2026-09-01'], ['foremanA', '2026-09-30']]);
        expect([result.closedCount, result.noRateCount, result.duplicateCount]).toEqual([0, 2, 0]);
        // 履歴も、入った2件だけ
        const logs = (mock(prisma.allowanceLog.createMany).mock.calls[0][0] as { data: Record<string, unknown>[] }).data;
        expect(logs.map((l) => [l.targetUserId, keyOf(l.recordDate)])).toEqual([['worker1', '2026-09-01'], ['foremanA', '2026-09-30']]);
    });

    it('入れる行が1件も無い（全部が、手当が始まる前の日付）ときは、createManyAndReturn を呼ばない・履歴も書かない', async () => {
        const result = await add({
            entries: [
                { userId: 'worker1', dateKey: '2026-08-31', payRole: 'member' },
                { userId: 'worker2', dateKey: '2026-08-01', payRole: 'member' },
            ],
        });
        expect(result).toEqual({ added: [], closedCount: 0, noRateCount: 2, duplicateCount: 0 });
        // 締めと金額までは読む。そのうえで、何も入れない
        expect(dbCalls()).toEqual(['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceMonthClose.findMany', 'tx.allowanceRate.findMany']);
    });

    it('金額の行が1つも無い手当は、1件も入れない（全部を noRateCount に数える）。履歴も書かない', async () => {
        mock(prisma.allowanceRate.findMany).mockResolvedValue([]);
        const result = await add({
            entries: [
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' },
                { userId: 'foremanA', dateKey: '2026-10-01', payRole: 'foreman' },
            ],
        });
        expect(result).toEqual({ added: [], closedCount: 0, noRateCount: 2, duplicateCount: 0 });
        noWrites();
    });

    it('締めた月の日付は入れない（closedCount に数える）。締めた月と締めていない月が混ざっていたら、締めていない月の分だけ入れる', async () => {
        closeMonths('2026-10');
        const result = await add({
            source: 'bulk',
            entries: [
                { userId: 'worker1', dateKey: '2026-10-01', payRole: 'member' }, // 締めた月
                { userId: 'worker1', dateKey: '2026-09-01', payRole: 'member' },
                { userId: 'worker2', dateKey: '2026-10-15', payRole: 'member' }, // 締めた月
                { userId: 'worker2', dateKey: '2026-09-30', payRole: 'member' },
            ],
        });

        // 締めは、出てくる月を重なりなく読む
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledWith({ where: { month: { in: ['2026-10', '2026-09'] } }, select: { month: true } });
        expect(insertedData().map((d) => [d.userId, keyOf(d.date)])).toEqual([['worker1', '2026-09-01'], ['worker2', '2026-09-30']]);
        expect(result.added.map((r) => [r.userId, keyOf(r.date)])).toEqual([['worker1', '2026-09-01'], ['worker2', '2026-09-30']]);
        expect([result.closedCount, result.noRateCount, result.duplicateCount]).toEqual([2, 0, 0]);
        // 履歴も、入った2件だけ
        const logs = (mock(prisma.allowanceLog.createMany).mock.calls[0][0] as { data: Record<string, unknown>[] }).data;
        expect(logs.map((l) => [l.targetUserId, keyOf(l.recordDate)])).toEqual([['worker1', '2026-09-01'], ['worker2', '2026-09-30']]);
    });

    it('全部が締めた月なら、金額も読まず、何も入れない・履歴も書かない（金額の無い手当でも、締めのほうに数える）', async () => {
        closeMonths('2026-09');
        mock(prisma.allowanceRate.findMany).mockResolvedValue([]);
        const result = await add({
            entries: [
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' },
                { userId: 'worker2', dateKey: '2026-09-01', payRole: 'member' },
            ],
        });
        expect(result).toEqual({ added: [], closedCount: 2, noRateCount: 0, duplicateCount: 0 });
        expect(dbCalls()).toEqual(['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceMonthClose.findMany']);
    });

    it('同じ人・同じ日が2回入っていたら、最初の1つだけにする（区分が違っても最初のほう。別の日・別の人は別の記録）', async () => {
        const result = await add({
            entries: [
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' },  // 最初（これを入れる）
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'foreman' }, // 同じ人・同じ日（2回目）
                { userId: 'worker1', dateKey: '2026-09-29', payRole: 'member' },  // 同じ人・別の日
                { userId: 'worker2', dateKey: '2026-09-30', payRole: 'foreman' }, // 別の人・同じ日（これを入れる）
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'foreman' }, // 同じ人・同じ日（3回目）
                { userId: 'worker2', dateKey: '2026-09-30', payRole: 'member' },  // 別の人の2回目
            ],
        });
        expect(insertedData().map((d) => [d.userId, keyOf(d.date), d.payRole, d.amount])).toEqual([
            ['worker1', '2026-09-30', 'member', 200],
            ['worker1', '2026-09-29', 'member', 200],
            ['worker2', '2026-09-30', 'foreman', 1500],
        ]);
        expect([result.added.length, result.closedCount, result.noRateCount, result.duplicateCount]).toEqual([3, 0, 0, 0]);
    });

    it('締めた月の日付・金額の無い日付に、同じ人・同じ日が2回入っていても、数えるのは1件ずつ', async () => {
        closeMonths('2026-10');
        const closedEntry = { userId: 'worker1', dateKey: '2026-10-01', payRole: 'member' as const };
        const noRateEntry = { userId: 'worker1', dateKey: '2026-08-31', payRole: 'member' as const };
        expect(await add({ entries: [closedEntry, noRateEntry, closedEntry, noRateEntry] }))
            .toEqual({ added: [], closedCount: 1, noRateCount: 1, duplicateCount: 0 });
        // 入れる行が残らないので、何も書かない
        noWrites();
    });

    it('履歴を書くのは、実際に入った行（createManyAndReturn が返した行）だけ。入らなかった分は duplicateCount', async () => {
        // 3件のうち、2件目だけが入った（1件目・3件目は、すでに記録があった）
        mock(prisma.allowanceRecord.createManyAndReturn).mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) =>
            [insertedRow(data[1], 'db-2')]);
        const result = await add({
            source: 'bulk',
            entries: [
                { userId: 'worker1', dateKey: '2026-09-28', payRole: 'member' },
                { userId: 'foremanA', dateKey: '2026-09-29', payRole: 'foreman' },
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' },
            ],
        });

        expect(insertedData()).toHaveLength(3); // 3件とも入れようとした
        expect(result.added.map((r) => r.id)).toEqual(['db-2']);
        expect([result.closedCount, result.noRateCount, result.duplicateCount]).toEqual([0, 0, 2]);
        expect(prisma.allowanceLog.createMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.createMany).toHaveBeenCalledWith({
            data: [{
                action: 'record_added', actorId: 'admin1', actorName: '管理者1',
                targetUserId: 'foremanA', itemId: 'large', recordId: 'db-2', recordDate: utc0('2026-09-29'),
                detail: { itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'confirmed', source: 'bulk' },
            }],
        });
    });

    it('1件も入らなければ（全部、すでに記録があった）、履歴を書かない', async () => {
        mock(prisma.allowanceRecord.createManyAndReturn).mockResolvedValue([]);
        expect(await add()).toEqual({ added: [], closedCount: 0, noRateCount: 0, duplicateCount: 1 });
        expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    });

    it('件数の数え方: 締めた月の分は closedCount・金額の無い日付の分は noRateCount・すでに記録があった分は duplicateCount（混ぜて数えない）', async () => {
        // 8月は締めてある。大規模手当の始まりは 9/10
        closeMonths('2026-08');
        mock(prisma.allowanceRate.findMany).mockResolvedValue([
            { id: 'rate1', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0('2026-09-10'), createdAt: new Date('2026-09-01T01:00:00.000Z') },
        ]);
        // 入れようとした2件のうち、9/30 だけが入った（9/29 は、すでに記録があった）
        mock(prisma.allowanceRecord.createManyAndReturn).mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) =>
            data.filter((d) => keyOf(d.date) === '2026-09-30').map((d, i) => insertedRow(d, `db-${i + 1}`)));
        const result = await add({
            source: 'bulk',
            entries: [
                { userId: 'worker1', dateKey: '2026-08-31', payRole: 'member' }, // 締めた月（金額も無い日付だが、締めのほうに数える）
                { userId: 'worker1', dateKey: '2026-09-09', payRole: 'member' }, // 手当が始まる前の日
                { userId: 'worker2', dateKey: '2026-09-01', payRole: 'member' }, // 手当が始まる前の日
                { userId: 'worker1', dateKey: '2026-09-29', payRole: 'member' }, // すでに記録があった
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' }, // 入った
                { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' }, // 同じ人・同じ日（数えない）
            ],
        });
        expect(insertedData().map((d) => keyOf(d.date))).toEqual(['2026-09-29', '2026-09-30']); // 入れようとしたのは、この2件だけ
        expect([result.added.length, result.closedCount, result.noRateCount, result.duplicateCount]).toEqual([1, 1, 2, 1]);
        const logs = (mock(prisma.allowanceLog.createMany).mock.calls[0][0] as { data: Record<string, unknown>[] }).data;
        expect(logs.map((l) => [l.recordId, keyOf(l.recordDate)])).toEqual([['db-1', '2026-09-30']]);
    });

    it('入れる相手を1件も渡さなければ、何も読まない・入れない（落ちない）', async () => {
        expect(await add({ entries: [] })).toEqual({ added: [], closedCount: 0, noRateCount: 0, duplicateCount: 0 });
        // トランザクションと鍵のほかには、DB に触らない
        expect(dbCalls().filter((name) => name !== 'prisma.$transaction' && name !== 'tx.$executeRaw')).toEqual([]);
    });

    it('履歴の中身: 入った行ごとに1行（record_added・操作した人・手当をもらう人・手当・記録の ID・日付・付けた時点の写し）', async () => {
        await add({
            entries: [
                { userId: 'foremanA', dateKey: '2026-09-30', payRole: 'foreman' },
                { userId: 'admin1', dateKey: '2026-10-01', payRole: 'member' }, // 自分に付けた分（確認待ち）
            ],
        });
        expect(prisma.allowanceLog.createMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.createMany).toHaveBeenCalledWith({
            data: [
                {
                    action: 'record_added', actorId: 'admin1', actorName: '管理者1',
                    targetUserId: 'foremanA', itemId: 'large', recordId: 'new-1', recordDate: utc0('2026-09-30'),
                    detail: { itemName: '大規模手当', payRole: 'foreman', amount: 1500, status: 'confirmed', source: 'manual' },
                },
                {
                    action: 'record_added', actorId: 'admin1', actorName: '管理者1',
                    targetUserId: 'admin1', itemId: 'large', recordId: 'new-2', recordDate: utc0('2026-10-01'),
                    detail: { itemName: '大規模手当', payRole: 'member', amount: 300, status: 'pending', source: 'manual' },
                },
            ],
        });
    });

    it('形の違う・実在しない日付が1つでも混ざっていたら、例外にして何も入れない（日付の形は、呼ぶ側が先に確かめる約束）', async () => {
        for (const bad of ['2026-02-30', '2026/09/30', '2026-9-30', '']) {
            await expect(add({
                entries: [
                    { userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' },
                    { userId: 'worker2', dateKey: bad, payRole: 'member' },
                ],
            })).rejects.toThrow('日付の形が違います');
        }
        noWrites();
    });
});

// ================================================================ 出勤簿入力のボタン

describe('toggleAllowanceForDay（「出勤簿入力」で、手当のボタンを1つ押したときの保存）', () => {
    const DAY = '2026-09-30';
    const BUTTON = { id: 'large', name: '大規模手当', isActive: true };

    /**
     * 職長A が、自分の班の「出勤簿入力」で、作業員1 の大規模手当のボタンを押して付ける。
     * targetPayRole は、呼ぶ側（route）が、その日の手配から決めた区分（作業員1 は「職長以外」）
     */
    const toggle = (over: Partial<ToggleAllowanceParams> = {}) => toggleAllowanceForDay({
        actor: FOREMAN_A, foremanId: 'foremanA', dateKey: DAY, targetUserId: 'worker1', on: true, item: BUTTON, targetPayRole: 'member', ...over,
    });
    /** 取り消す（route は、取り消すときは手配を読まず、targetPayRole を null で渡す） */
    const untoggle = (over: Partial<ToggleAllowanceParams> = {}) => toggle({ on: false, targetPayRole: null, ...over });
    /** 今ある記録を決める（findFirst が返す行） */
    const existingIs = (row: AllowanceRecordRow | null) => mock(prisma.allowanceRecord.findFirst).mockResolvedValue(row);

    it('締めは「その日の月」、今の記録は「その人・その日（UTC 0時の印）・その手当」で読む（列は絞らない）', async () => {
        await toggle();
        expect(mock(prisma.allowanceMonthClose.findMany).mock.calls[0][0]).toEqual({ where: { month: { in: ['2026-09'] } }, select: { month: true } });
        expect(prisma.allowanceRecord.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.findFirst).toHaveBeenCalledWith({ where: { userId: 'worker1', date: utc0(DAY), itemId: 'large' } });
    });

    it("手当が見つからない（item が null）→ 'not_found'。今の記録は読まない（付けるのも取り消すのも）", async () => {
        existingIs(recordRow());
        expect(await toggle({ item: null })).toBe('not_found');
        expect(await untoggle({ item: null })).toBe('not_found');
        expect(prisma.allowanceRecord.findFirst).not.toHaveBeenCalled();
        noWrites();
    });

    it('日付の形が違えば例外にする。DB には触らない', async () => {
        for (const bad of ['2026-02-30', '2026/09/30', '2026-9-30', '']) {
            await expect(toggle({ dateKey: bad })).rejects.toThrow('日付の形が違います');
            await expect(untoggle({ dateKey: bad })).rejects.toThrow('日付の形が違います');
        }
        expect(dbCalls()).toEqual([]);
    });

    describe('付ける（on: true）', () => {
        it('順番: トランザクションの中で、鍵 → 締めを読む → 今の記録を読む → 金額を読む → 入れる → 履歴（全部 tx で）', async () => {
            expect(await toggle()).toBe('added');
            // 入れる直前にも、もう一度締めを読むので、同じ名前の2回目以降は除いて、始まった順番だけを見る
            expect(dbCallOrder()).toEqual([
                'prisma.$transaction',
                'tx.$executeRaw',
                'tx.allowanceMonthClose.findMany',
                'tx.allowanceRecord.findFirst',
                'tx.allowanceRate.findMany',
                'tx.allowanceRecord.createManyAndReturn',
                'tx.allowanceLog.createMany',
            ]);
            expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceLog.createMany).toHaveBeenCalledTimes(1);
        });

        it("その日の手配で「職長以外」の人に付ける: 職長以外の金額で 'confirmed'。source は 'attendance'・foremanId は、押した画面の職長 → 'added'（履歴つき）", async () => {
            expect(await toggle()).toBe('added');
            expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledWith({
                data: [{
                    userId: 'worker1', date: utc0(DAY), itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200, rateId: 'rate1',
                    status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null, createdBy: 'foremanA', createdByName: '職長A',
                }],
                skipDuplicates: true,
            });
            expect(prisma.allowanceLog.createMany).toHaveBeenCalledWith({
                data: [{
                    action: 'record_added', actorId: 'foremanA', actorName: '職長A',
                    targetUserId: 'worker1', itemId: 'large', recordId: 'new-1', recordDate: utc0(DAY),
                    detail: { itemName: '大規模手当', payRole: 'member', amount: 200, status: 'confirmed', source: 'attendance' },
                }],
            });
        });

        it("その日の手配で「職長」の人（職長本人）が、自分の行に付ける: 職長の金額で 'pending'（自分の分は確認待ち）", async () => {
            expect(await toggle({ targetUserId: 'foremanA', targetPayRole: 'foreman' })).toBe('added');
            expect(insertedData()).toEqual([{
                userId: 'foremanA', date: utc0(DAY), itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500, rateId: 'rate1',
                status: 'pending', source: 'attendance', foremanId: 'foremanA', note: null, createdBy: 'foremanA', createdByName: '職長A',
            }]);
        });

        it("職長本人の行に、管理者が付ける: 職長の金額で 'confirmed'（foremanId は押した画面の職長、付けた人は管理者）", async () => {
            expect(await toggle({ actor: ADMIN, targetUserId: 'foremanA', targetPayRole: 'foreman' })).toBe('added');
            expect(insertedData()).toEqual([{
                userId: 'foremanA', date: utc0(DAY), itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500, rateId: 'rate1',
                status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null, createdBy: 'admin1', createdByName: '管理者1',
            }]);
        });

        it("管理者が、職長A の班の「出勤簿入力」で自分の行に付ける: 'pending'（自分の分は確認待ち）", async () => {
            expect(await toggle({ actor: ADMIN, targetUserId: 'admin1', targetPayRole: 'member' })).toBe('added');
            expect(insertedData()[0]).toMatchObject({ userId: 'admin1', payRole: 'member', amount: 200, status: 'pending', foremanId: 'foremanA', createdBy: 'admin1' });
        });

        it('職長／職長以外は、渡された targetPayRole のとおりに入れる（押した画面の職長かどうか・押した人がだれかでは決めない）', async () => {
            // 職長A の班の画面に出ている職長B が、その日、自分の班（対象の現場）の職長でもある → 手配で決まる区分は「職長」
            expect(await toggle({ targetUserId: 'foremanB', targetPayRole: 'foreman' })).toBe('added');
            expect(insertedData(0)[0]).toMatchObject({ userId: 'foremanB', payRole: 'foreman', amount: 1500, status: 'confirmed', foremanId: 'foremanA', createdBy: 'foremanA' });

            // 区分が「職長以外」と渡されたら、画面の職長と同じ人でも「職長以外」の金額（区分を決めるのは、呼ぶ側の手配の読み方）
            expect(await toggle({ targetUserId: 'foremanA', targetPayRole: 'member' })).toBe('added');
            expect(insertedData(1)[0]).toMatchObject({ userId: 'foremanA', payRole: 'member', amount: 200, status: 'pending', foremanId: 'foremanA' });

            // 役職が職長の人でも、区分が「職長以外」なら「職長以外」の金額
            expect(await toggle({ actor: ADMIN, targetUserId: 'foremanB', targetPayRole: 'member' })).toBe('added');
            expect(insertedData(2)[0]).toMatchObject({ userId: 'foremanB', payRole: 'member', amount: 200, status: 'confirmed' });
        });

        it('金額は、その日付に有効な金額（金額を変えた日からは、新しい金額）', async () => {
            expect(await toggle({ dateKey: '2026-10-01', targetUserId: 'foremanA', targetPayRole: 'foreman' })).toBe('added');
            expect(await toggle({ dateKey: '2026-10-01' })).toBe('added');
            expect([insertedData(0)[0], insertedData(1)[0]].map((d) => [d.userId, keyOf(d.date), d.payRole, d.amount, d.rateId])).toEqual([
                ['foremanA', '2026-10-01', 'foreman', 2000, 'rate2'],
                ['worker1', '2026-10-01', 'member', 300, 'rate2'],
            ]);
        });

        it("すでに付いている → 'unchanged'。何も書かない（締めた月でも・使っていない手当でも・対象の現場の手配に入っていなくても 'unchanged'）", async () => {
            existingIs(recordRow());
            expect(await toggle()).toBe('unchanged');
            closeMonths('2026-09');
            expect(await toggle({ targetPayRole: null, item: { ...BUTTON, isActive: false } })).toBe('unchanged');
            noWrites();
        });

        it("すでに付いている記録の区分が、今の手配の区分と違っていても 'unchanged'（区分も金額も、先に付いた記録のまま。書きかえない）", async () => {
            // 職長B には、先に「職長以外」で付いた記録がある（職長A が付けた）。今の手配では「職長」
            existingIs(recordRow({ userId: 'foremanB', payRole: 'member', amount: 200, createdBy: 'foremanA', createdByName: '職長A' }));
            const foremanB: AllowanceActor = { id: 'foremanB', role: 'foreman1', name: '職長B' };
            expect(await toggle({ actor: foremanB, foremanId: 'foremanB', targetUserId: 'foremanB', targetPayRole: 'foreman' })).toBe('unchanged');
            // 自分の分（確定）なので、自分では取り消せない（付け直すには、管理者・マネージャーが取り消す）
            expect(await untoggle({ actor: foremanB, foremanId: 'foremanB', targetUserId: 'foremanB' })).toBe('blocked');
            noWrites();
        });

        it("締めた月には付けられない → 'closed'（使っていない手当・対象の現場の手配に入っていない場合より先に見る）。何も書かない", async () => {
            closeMonths('2026-09');
            expect(await toggle()).toBe('closed');
            expect(await toggle({ actor: ADMIN })).toBe('closed'); // 管理者が押しても
            expect(await toggle({ targetPayRole: null, item: { ...BUTTON, isActive: false } })).toBe('closed');
            noWrites();
        });

        it("「使わない」になっている手当 → 'inactive'（対象の現場の手配に入っていない場合より先に見る。管理者が押しても）", async () => {
            for (const actor of [FOREMAN_A, ADMIN]) {
                expect([actor.role, await toggle({ actor, item: { ...BUTTON, isActive: false } })]).toEqual([actor.role, 'inactive']);
                expect([actor.role, await toggle({ actor, item: { ...BUTTON, isActive: false }, targetPayRole: null })]).toEqual([actor.role, 'inactive']);
            }
            noWrites();
        });

        it("その人が、その日、その班の対象の現場の手配に入っていない（targetPayRole が null）→ 'not_target'（管理者が押しても）", async () => {
            for (const actor of [FOREMAN_A, ADMIN]) {
                expect([actor.role, await toggle({ actor, targetPayRole: null })]).toEqual([actor.role, 'not_target']);
            }
            // 金額も読まない・何も書かない
            expect(prisma.allowanceRate.findMany).not.toHaveBeenCalled();
            noWrites();
        });

        it("金額の行が1つも無い → 'no_rate'。何も入れない", async () => {
            mock(prisma.allowanceRate.findMany).mockResolvedValue([]);
            expect(await toggle()).toBe('no_rate');
            noWrites();
        });

        it("手当が始まる前の日付（いちばん古い適用開始日より前）には付けられない → 'no_rate'。何も入れない（始まりの日の当日からは付けられる）", async () => {
            // 大規模手当の始まりは 9/1
            expect(await toggle({ dateKey: '2026-08-31' })).toBe('no_rate');
            expect(await toggle({ dateKey: '2026-08-31', actor: ADMIN, targetUserId: 'foremanA', targetPayRole: 'foreman' })).toBe('no_rate'); // 管理者が押しても
            noWrites();

            expect(await toggle({ dateKey: '2026-09-01' })).toBe('added');
            expect(insertedData().map((d) => [d.userId, keyOf(d.date), d.amount, d.rateId])).toEqual([['worker1', '2026-09-01', 200, 'rate1']]);
        });

        it("同時に別の端末が先に入れていて入らなかった（createManyAndReturn が空を返した）→ 'unchanged'。履歴は書かない", async () => {
            mock(prisma.allowanceRecord.createManyAndReturn).mockResolvedValue([]);
            expect(await toggle()).toBe('unchanged');
            expect(prisma.allowanceRecord.createManyAndReturn).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
            expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
        });
    });

    describe('取り消す（on: false）', () => {
        it("自分が付けた、ほかの人の記録を取り消す: 条件は「記録の ID」と「読んだときの status」→ 'removed'。順番は 鍵 → 締めを読む → 今の記録を読む → 消す → 履歴（全部 tx で）", async () => {
            existingIs(recordRow());
            expect(await untoggle()).toBe('removed');
            expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', status: 'confirmed' } });
            expect(dbCalls()).toEqual([
                'prisma.$transaction',
                'tx.$executeRaw',
                'tx.allowanceMonthClose.findMany',
                'tx.allowanceRecord.findFirst',
                'tx.allowanceRecord.deleteMany',
                'tx.allowanceLog.create',
            ]);
        });

        it('取り消したら履歴を1行書く（record_removed）。detail に、取り消した記録の全部の列を残す（日付は YYYY-MM-DD・日時は ISO 文字列）', async () => {
            const existing = recordRow();
            existingIs(existing);
            expect(await untoggle()).toBe('removed');
            expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceLog.create).toHaveBeenCalledWith({
                data: {
                    action: 'record_removed', actorId: 'foremanA', actorName: '職長A',
                    targetUserId: 'worker1', itemId: 'large', recordId: 'r1', recordDate: utc0(DAY),
                    detail: {
                        id: 'r1', userId: 'worker1', date: '2026-09-30', itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200,
                        rateId: 'rate1', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: null,
                        createdBy: 'foremanA', createdByName: '職長A', confirmedBy: null, confirmedByName: null, confirmedAt: null,
                        createdAt: '2026-09-30T09:00:00.000Z', updatedAt: '2026-09-30T09:00:00.000Z',
                    },
                },
            });
            // 読んだ行に無い列を足していない・列を落としていない
            const detail = (mock(prisma.allowanceLog.create).mock.calls[0][0] as { data: { detail: Record<string, unknown> } }).data.detail;
            expect(Object.keys(detail).sort()).toEqual(Object.keys(existing).sort());
        });

        it('認められた記録（confirmedAt が入っている）を管理者が取り消したら、detail の confirmedAt も ISO 文字列', async () => {
            existingIs(recordRow({
                id: 'own1', userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'confirmed', note: '現場で確認',
                confirmedBy: 'manager1', confirmedByName: 'マネージャー1', confirmedAt: new Date('2026-10-01T02:03:04.567Z'),
            }));
            expect(await untoggle({ actor: ADMIN, targetUserId: 'foremanA' })).toBe('removed');
            const data = (mock(prisma.allowanceLog.create).mock.calls[0][0] as { data: Record<string, unknown> }).data;
            expect(data).toMatchObject({ action: 'record_removed', actorId: 'admin1', actorName: '管理者1', targetUserId: 'foremanA', recordId: 'own1' });
            expect(data.detail).toMatchObject({
                id: 'own1', date: '2026-09-30', note: '現場で確認', confirmedBy: 'manager1', confirmedByName: 'マネージャー1', confirmedAt: '2026-10-01T02:03:04.567Z',
            });
        });

        it("消えた件数が 0（読んだあとで状態が変わっていた）→ 'unchanged'。履歴は書かない", async () => {
            existingIs(recordRow());
            mock(prisma.allowanceRecord.deleteMany).mockResolvedValue({ count: 0 });
            expect(await untoggle()).toBe('unchanged');
            expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
            expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
        });

        it("もう無い記録の取り消しは 'unchanged'（締めた月でも）。何も消さない", async () => {
            existingIs(null);
            expect(await untoggle()).toBe('unchanged');
            closeMonths('2026-09');
            expect(await untoggle()).toBe('unchanged');
            noWrites();
        });

        it("締めた月の記録は取り消せない → 'closed'（自分が付けた記録でも・管理者でも・ほかの職長が付けた記録でも）", async () => {
            closeMonths('2026-09');
            existingIs(recordRow());
            expect(await untoggle()).toBe('closed');
            expect(await untoggle({ actor: ADMIN })).toBe('closed');
            existingIs(recordRow({ createdBy: 'foremanB', createdByName: '職長B' })); // 締めていなければ 'blocked'
            expect(await untoggle()).toBe('closed');
            noWrites();
        });

        it("ほかの人（ほかの職長・管理者）が付けた記録・確定した自分の分は、職長には取り消せない → 'blocked'（記録は残る）", async () => {
            existingIs(recordRow({ createdBy: 'foremanB', createdByName: '職長B' }));
            expect(await untoggle()).toBe('blocked');
            existingIs(recordRow({ createdBy: 'admin1', createdByName: '管理者1' }));
            expect(await untoggle()).toBe('blocked');
            // 確定した自分の分（管理者・マネージャーに認められた後）
            existingIs(recordRow({ userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'confirmed', confirmedBy: 'admin1', confirmedByName: '管理者1', confirmedAt: new Date('2026-10-01T00:00:00.000Z') }));
            expect(await untoggle({ targetUserId: 'foremanA' })).toBe('blocked');
            noWrites();
        });

        it("自分の確認待ちは取り消せる（条件の status は 'pending'）", async () => {
            existingIs(recordRow({ id: 'p1', userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'pending' }));
            expect(await untoggle({ targetUserId: 'foremanA' })).toBe('removed');
            expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'pending' } });
            expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        });

        it('管理者・マネージャーは、ほかの人が付けた記録も取り消せる', async () => {
            for (const actor of [ADMIN, MANAGER]) {
                mock(prisma.allowanceRecord.deleteMany).mockClear();
                existingIs(recordRow({ createdBy: 'foremanB', createdByName: '職長B' }));
                expect([actor.role, await untoggle({ actor })]).toEqual([actor.role, 'removed']);
                expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', status: 'confirmed' } });
            }
        });

        it('取り消しは、「使わない」になっている手当でも・その人が対象の現場の手配に入っていなくても（targetPayRole が null でも）できる', async () => {
            existingIs(recordRow());
            expect(await untoggle({ item: { ...BUTTON, isActive: false }, targetPayRole: null })).toBe('removed');
            expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
        });
    });
});

// ================================================================ 記録を取り消す・認める（「手当」の画面）

describe('removeAllowanceRecord（「手当」の画面で、記録を1件取り消す）', () => {
    /** 取り消そうとしている記録を決める（findUnique が返す行） */
    const recordIs = (row: AllowanceRecordRow | null) => mock(prisma.allowanceRecord.findUnique).mockResolvedValue(row);

    it("その記録が無い → 'not_found'。鍵を取って記録を読むだけ（締めは読まない・何も消さない）", async () => {
        expect(await removeAllowanceRecord(ADMIN, 'ghost')).toBe('not_found');
        // 記録は ID で、列を絞らずに読む（取り消したときに、履歴へ全部の列を写すため）
        expect(prisma.allowanceRecord.findUnique).toHaveBeenCalledWith({ where: { id: 'ghost' } });
        expect(dbCalls()).toEqual(['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceRecord.findUnique']);
    });

    it("締めた月の記録 → 'closed'（管理者でも。取り消す権限が無い場合より先に見る）", async () => {
        closeMonths('2026-08');
        recordIs(recordRow({ date: utc0('2026-08-31') }));
        expect(await removeAllowanceRecord(ADMIN, 'r1')).toBe('closed');
        // 締めは、記録の日付の月で読む
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledWith({ where: { month: { in: ['2026-08'] } }, select: { month: true } });

        // 確定した自分の分（締めていなければ 'forbidden'）でも、締めた月なら 'closed'
        recordIs(recordRow({ date: utc0('2026-08-31'), userId: 'admin1', createdBy: 'admin1', createdByName: '管理者1', status: 'confirmed' }));
        expect(await removeAllowanceRecord(ADMIN, 'r1')).toBe('closed');
        noWrites();
    });

    it("取り消す権限が無い → 'forbidden'（確定した自分の分・ほかの人が付けた自分の確認待ち・職長がほかの人の付けた記録・作業員）", async () => {
        recordIs(recordRow({ userId: 'admin1', createdBy: 'admin1', createdByName: '管理者1', status: 'confirmed' }));
        expect(await removeAllowanceRecord(ADMIN, 'r1')).toBe('forbidden');
        recordIs(recordRow({ userId: 'admin1', createdBy: 'foremanA', status: 'pending' }));
        expect(await removeAllowanceRecord(ADMIN, 'r1')).toBe('forbidden');
        recordIs(recordRow({ createdBy: 'foremanB', createdByName: '職長B' }));
        expect(await removeAllowanceRecord(FOREMAN_A, 'r1')).toBe('forbidden');
        recordIs(recordRow({ userId: 'worker2', createdBy: 'worker1', createdByName: '作業員1' }));
        expect(await removeAllowanceRecord(WORKER, 'r1')).toBe('forbidden');
        noWrites();
    });

    it("読んだあとで状態が変わっていた（消えた件数が 0）→ 'changed'。履歴は書かない", async () => {
        recordIs(recordRow());
        mock(prisma.allowanceRecord.deleteMany).mockResolvedValue({ count: 0 });
        expect(await removeAllowanceRecord(ADMIN, 'r1')).toBe('changed');
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
    });

    it("取り消した → 'removed'。条件は「記録の ID」と「読んだときの status」。履歴に、取り消した記録の全部の列を残す", async () => {
        recordIs(recordRow({ note: '付けまちがい' }));
        expect(await removeAllowanceRecord(MANAGER, 'r1')).toBe('removed');
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', status: 'confirmed' } });
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.create).toHaveBeenCalledWith({
            data: {
                action: 'record_removed', actorId: 'manager1', actorName: 'マネージャー1',
                targetUserId: 'worker1', itemId: 'large', recordId: 'r1', recordDate: utc0('2026-09-30'),
                detail: {
                    id: 'r1', userId: 'worker1', date: '2026-09-30', itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200,
                    rateId: 'rate1', status: 'confirmed', source: 'attendance', foremanId: 'foremanA', note: '付けまちがい',
                    createdBy: 'foremanA', createdByName: '職長A', confirmedBy: null, confirmedByName: null, confirmedAt: null,
                    createdAt: '2026-09-30T09:00:00.000Z', updatedAt: '2026-09-30T09:00:00.000Z',
                },
            },
        });
    });

    it("自分で付けた自分の確認待ちは、取り下げられる（条件の status は 'pending'）", async () => {
        recordIs(recordRow({ id: 'p1', userId: 'admin1', createdBy: 'admin1', createdByName: '管理者1', status: 'pending' }));
        expect(await removeAllowanceRecord(ADMIN, 'p1')).toBe('removed');
        expect(prisma.allowanceRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'pending' } });
    });

    it('順番: トランザクションの中で、鍵 → 記録を読む → 締めを読む → 消す → 履歴（全部 tx で）', async () => {
        recordIs(recordRow());
        expect(await removeAllowanceRecord(ADMIN, 'r1')).toBe('removed');
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.$executeRaw',
            'tx.allowanceRecord.findUnique',
            'tx.allowanceMonthClose.findMany',
            'tx.allowanceRecord.deleteMany',
            'tx.allowanceLog.create',
        ]);
    });
});

describe('confirmAllowanceRecords（確認待ちの記録を認める）', () => {
    /** 認めるときに読む列だけを持つ行。既定は「職長A が自分に付けた、9/30 の確認待ち」 */
    const pendingRow = (over: Record<string, unknown> = {}) => ({
        id: 'p1', userId: 'foremanA', date: utc0('2026-09-30'), itemId: 'large', itemName: '大規模手当', payRole: 'foreman', amount: 1500,
        status: 'pending', createdBy: 'foremanA', ...over,
    });
    const recordsAre = (rows: unknown[]) => mock(prisma.allowanceRecord.findMany).mockResolvedValue(rows);
    /** 履歴（createMany）に書いた行 */
    const loggedRows = () => (mock(prisma.allowanceLog.createMany).mock.calls[0][0] as { data: Record<string, unknown>[] }).data;

    it('ids が空なら、DB に触らない', async () => {
        expect(await confirmAllowanceRecords(ADMIN, [])).toEqual({ confirmed: 0, skipped: 0 });
        expect(dbCalls()).toEqual([]);
    });

    it('重なりを除いて読み、認めてよい記録を、まとめて1回で確定にする（条件は「その ID で、確認待ちのまま」。認めた人・名前・日時を入れる）', async () => {
        freezeNow('2026-10-02T03:04:05.000Z'); // 認めた日時（今）が入ることを確かめるので、時計を固定する
        recordsAre([pendingRow({ id: 'p1' }), pendingRow({ id: 'p2', userId: 'foremanB', createdBy: 'foremanB' })]);

        expect(await confirmAllowanceRecords(ADMIN, ['p1', 'p2', 'p1'])).toEqual({ confirmed: 2, skipped: 0 });

        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledWith({
            where: { id: { in: ['p1', 'p2'] } },
            select: { id: true, userId: true, date: true, itemId: true, itemName: true, payRole: true, amount: true, status: true, createdBy: true },
        });
        // 1件ずつではなく、1回の updateMany
        expect(prisma.allowanceRecord.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['p1', 'p2'] }, status: 'pending' },
            data: { status: 'confirmed', confirmedBy: 'admin1', confirmedByName: '管理者1', confirmedAt: new Date('2026-10-02T03:04:05.000Z') },
        });
    });

    it('認めないもの: 無い ID・確定済み・自分の分・締めた月の記録（skipped に数える。確定にする条件にも、履歴にも入れない）', async () => {
        closeMonths('2026-08');
        recordsAre([
            pendingRow({ id: 'ok' }),
            pendingRow({ id: 'done', status: 'confirmed' }),                              // 確定済み
            pendingRow({ id: 'mine', userId: 'admin1', createdBy: 'admin1', payRole: 'member', amount: 200 }), // 自分の分
            pendingRow({ id: 'old', date: utc0('2026-08-31') }),                          // 締めた月
            pendingRow({ id: 'ok2', userId: 'worker2', createdBy: 'worker2', payRole: 'member', amount: 200 }),
        ]);

        expect(await confirmAllowanceRecords(ADMIN, ['ok', 'done', 'mine', 'old', 'ghost', 'ok2'])).toEqual({ confirmed: 2, skipped: 4 });

        // 締めは、読んだ記録の日付の月（重なりなし）で読む
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledWith({ where: { month: { in: ['2026-09', '2026-08'] } }, select: { month: true } });
        expect(prisma.allowanceRecord.updateMany).toHaveBeenCalledTimes(1);
        expect(mock(prisma.allowanceRecord.updateMany).mock.calls[0][0].where).toEqual({ id: { in: ['ok', 'ok2'] }, status: 'pending' });
        expect(loggedRows().map((l) => l.recordId)).toEqual(['ok', 'ok2']);
    });

    it('認めてよい記録が1件も無ければ、updateMany も履歴も呼ばない（全部を skipped に数える）', async () => {
        recordsAre([pendingRow({ id: 'done', status: 'confirmed' }), pendingRow({ id: 'mine', userId: 'admin1', createdBy: 'admin1' })]);
        expect(await confirmAllowanceRecords(ADMIN, ['done', 'mine', 'ghost'])).toEqual({ confirmed: 0, skipped: 3 });
        expect(prisma.allowanceRecord.updateMany).not.toHaveBeenCalled();
        noWrites();
    });

    it('確定にできた件数が、認めようとした件数と合わなければ、例外にする（トランザクションごと取りやめ。履歴も書かない）', async () => {
        recordsAre([pendingRow({ id: 'p1' }), pendingRow({ id: 'p2', userId: 'foremanB', createdBy: 'foremanB' })]);
        for (const count of [0, 1, 3]) {
            mock(prisma.allowanceRecord.updateMany).mockResolvedValue({ count });
            await expect(confirmAllowanceRecords(ADMIN, ['p1', 'p2'])).rejects.toThrow('認めた件数が合いません');
        }
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
    });

    it('履歴の中身: 認めた記録ごとに1行を、まとめて1回で書く（record_confirmed・認めた人・手当をもらう人・手当・記録の ID・日付・金額の写し）', async () => {
        recordsAre([
            pendingRow({ id: 'p1' }),
            pendingRow({ id: 'p2', userId: 'manager1', createdBy: 'manager1', date: utc0('2026-10-01'), payRole: 'member', amount: 300 }),
        ]);
        expect(await confirmAllowanceRecords(ADMIN, ['p1', 'p2'])).toEqual({ confirmed: 2, skipped: 0 });
        expect(prisma.allowanceLog.createMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.createMany).toHaveBeenCalledWith({
            data: [
                {
                    action: 'record_confirmed', actorId: 'admin1', actorName: '管理者1',
                    targetUserId: 'foremanA', itemId: 'large', recordId: 'p1', recordDate: utc0('2026-09-30'),
                    detail: { itemName: '大規模手当', payRole: 'foreman', amount: 1500 },
                },
                {
                    action: 'record_confirmed', actorId: 'admin1', actorName: '管理者1',
                    targetUserId: 'manager1', itemId: 'large', recordId: 'p2', recordDate: utc0('2026-10-01'),
                    detail: { itemName: '大規模手当', payRole: 'member', amount: 300 },
                },
            ],
        });
    });

    it('マネージャーも認められる（自分の分は認められない）', async () => {
        recordsAre([pendingRow({ id: 'p1' }), pendingRow({ id: 'mine', userId: 'manager1', createdBy: 'manager1' })]);
        expect(await confirmAllowanceRecords(MANAGER, ['p1', 'mine'])).toEqual({ confirmed: 1, skipped: 1 });
        expect(mock(prisma.allowanceRecord.updateMany).mock.calls[0][0]).toMatchObject({
            where: { id: { in: ['p1'] }, status: 'pending' },
            data: { status: 'confirmed', confirmedBy: 'manager1', confirmedByName: 'マネージャー1' },
        });
    });

    it('管理者・マネージャー以外（職長・作業員・協力会社）は、1件も認めない', async () => {
        recordsAre([pendingRow({ id: 'p1', userId: 'foremanB', createdBy: 'foremanB' }), pendingRow({ id: 'p2', userId: 'worker2', createdBy: 'worker2' })]);
        for (const actor of [FOREMAN_A, WORKER, { id: 'partner1', role: 'partner', name: '協力会社1' }]) {
            expect([actor.role, await confirmAllowanceRecords(actor, ['p1', 'p2'])]).toEqual([actor.role, { confirmed: 0, skipped: 2 }]);
        }
        noWrites();
    });

    it('順番: トランザクションの中で、鍵 → 記録を読む → 締めを読む → 確定にする → 履歴（全部 tx で・どれも1回ずつ）', async () => {
        recordsAre([pendingRow({ id: 'p1' }), pendingRow({ id: 'p2', userId: 'foremanB', createdBy: 'foremanB' })]);
        expect(await confirmAllowanceRecords(ADMIN, ['p1', 'p2'])).toEqual({ confirmed: 2, skipped: 0 });
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.$executeRaw',
            'tx.allowanceRecord.findMany',
            'tx.allowanceMonthClose.findMany',
            'tx.allowanceRecord.updateMany',
            'tx.allowanceLog.createMany',
        ]);
    });
});

// ================================================================ 月を締める・締めを外す

describe('closeAllowanceMonth（月を締める）', () => {
    /** 「今日」は 2026-10-04（引数で渡す） */
    const close = (month: unknown, todayKey = '2026-10-04') => closeAllowanceMonth(ADMIN, month, todayKey);
    /** その月の記録（締めるときに読む列だけ） */
    const recordsAre = (rows: { userId: string; payRole: string; amount: number; status: string }[]) =>
        mock(prisma.allowanceRecord.findMany).mockResolvedValue(rows);

    it("月の形が違う → 'invalid_month'。DB には触らない（年は 2000〜2999 だけ。'0026-09' のような年も受け付けない）", async () => {
        for (const bad of ['2026-9', '2026-13', '2026-00', '202609', '2026-09-01', '', ' 2026-09', '0026-09', '1999-12', '3000-01', null, undefined, 202609, {}]) {
            expect([bad, await close(bad)]).toEqual([bad, { ok: false, reason: 'invalid_month' }]);
        }
        expect(dbCalls()).toEqual([]);
    });

    it("まだ終わっていない月（今月・先の月）→ 'not_ended'。DB には触らない", async () => {
        expect(await close('2026-10', '2026-10-04')).toEqual({ ok: false, reason: 'not_ended' });
        expect(await close('2026-10', '2026-10-31')).toEqual({ ok: false, reason: 'not_ended' }); // 月の最後の日でも、まだ今月
        expect(await close('2026-11', '2026-10-04')).toEqual({ ok: false, reason: 'not_ended' });
        expect(await close('2099-12', '2026-10-04')).toEqual({ ok: false, reason: 'not_ended' });
        expect(dbCalls()).toEqual([]);
    });

    it('月が変わった日から、前の月を締められる（年をまたぐ月も）', async () => {
        expect(await close('2026-09', '2026-10-01')).toEqual({ ok: true, closedAt: CLOSED_AT });
        expect(await close('2026-12', '2027-01-01')).toEqual({ ok: true, closedAt: CLOSED_AT });
        expect(await close('2025-01', '2026-10-04')).toEqual({ ok: true, closedAt: CLOSED_AT }); // ずっと前の月
    });

    it('「今日」を渡さなければ、日本時間の今日で決める（UTC ではまだ前の月でも、日本時間で月が変わっていれば締められる）', async () => {
        freezeNow('2026-09-30T15:30:00.000Z'); // 日本時間 10/1 0:30（UTC では 9/30）
        expect(await closeAllowanceMonth(ADMIN, '2026-09')).toEqual({ ok: true, closedAt: CLOSED_AT });
        expect(await closeAllowanceMonth(ADMIN, '2026-10')).toEqual({ ok: false, reason: 'not_ended' });

        freezeNow('2026-09-30T14:59:00.000Z'); // 日本時間 9/30 23:59
        expect(await closeAllowanceMonth(ADMIN, '2026-09')).toEqual({ ok: false, reason: 'not_ended' });
        expect(await closeAllowanceMonth(ADMIN, '2026-08')).toEqual({ ok: true, closedAt: CLOSED_AT });
    });

    it("すでに締めてある → 'already_closed'。記録も読まない・作らない・履歴なし（確認待ちが残っていても、こちらを先に返す）", async () => {
        mock(prisma.allowanceMonthClose.findUnique).mockResolvedValue({ month: '2026-09' });
        recordsAre([{ userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'pending' }]);

        expect(await close('2026-09')).toEqual({ ok: false, reason: 'already_closed' });
        expect(prisma.allowanceMonthClose.findUnique).toHaveBeenCalledWith({ where: { month: '2026-09' }, select: { month: true } });
        expect(dbCalls()).toEqual(['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceMonthClose.findUnique']);
    });

    it('その月の記録だけを読む（月の1日以上・翌月1日より前。UTC 0時の印）', async () => {
        await close('2026-09');
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledWith({
            where: { date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') } },
            select: { userId: true, payRole: true, amount: true, status: true },
        });

        // 12月は、翌年の1月1日より前
        mock(prisma.allowanceRecord.findMany).mockClear();
        await close('2026-12', '2027-01-01');
        expect(mock(prisma.allowanceRecord.findMany).mock.calls[0][0].where).toEqual({ date: { gte: utc0('2026-12-01'), lt: utc0('2027-01-01') } });
    });

    it("確認待ちが1件でも残っていれば { ok: false, reason: 'has_pending', pendingCount }。締めない・履歴も書かない", async () => {
        recordsAre([
            { userId: 'worker1', payRole: 'member', amount: 200, status: 'confirmed' },
            { userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'pending' },
        ]);
        expect(await close('2026-09')).toEqual({ ok: false, reason: 'has_pending', pendingCount: 1 });

        recordsAre([
            { userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'pending' },
            { userId: 'worker1', payRole: 'member', amount: 200, status: 'confirmed' },
            { userId: 'foremanB', payRole: 'foreman', amount: 1500, status: 'pending' },
            { userId: 'admin1', payRole: 'member', amount: 200, status: 'pending' },
        ]);
        expect(await close('2026-09')).toEqual({ ok: false, reason: 'has_pending', pendingCount: 3 });
        noWrites();
    });

    it('締める: 締めた月の行を作り（月・締めた人・名前）、履歴に「締めた時点の数字」を残す。返すのは、作った行の日時', async () => {
        recordsAre([
            { userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'confirmed' },
            { userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'confirmed' },
            { userId: 'foremanA', payRole: 'member', amount: 200, status: 'confirmed' },  // ほかの人の班に入った日
            { userId: 'worker1', payRole: 'member', amount: 200, status: 'confirmed' },
            { userId: 'worker2', payRole: 'member', amount: 300, status: 'confirmed' },
        ]);

        const result = await close('2026-09');
        expect(result).toEqual({ ok: true, closedAt: CLOSED_AT });

        expect(prisma.allowanceMonthClose.create).toHaveBeenCalledTimes(1);
        expect(mock(prisma.allowanceMonthClose.create).mock.calls[0][0].data).toEqual({ month: '2026-09', closedBy: 'admin1', closedByName: '管理者1' });
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.create).toHaveBeenCalledWith({
            data: {
                action: 'month_closed', actorId: 'admin1', actorName: '管理者1', month: '2026-09',
                // 記録 5件・3人・職長として 2日・職長以外として 3日・合計 3,700円
                detail: { records: 5, people: 3, foremanDays: 2, memberDays: 3, totalAmount: 3700 },
            },
        });
    });

    it('記録が1件も無い月も締められる（履歴の数字は全部 0）', async () => {
        recordsAre([]);
        expect(await close('2026-09')).toEqual({ ok: true, closedAt: CLOSED_AT });
        expect((mock(prisma.allowanceLog.create).mock.calls[0][0] as { data: { detail: unknown } }).data.detail)
            .toEqual({ records: 0, people: 0, foremanDays: 0, memberDays: 0, totalAmount: 0 });
    });

    it("DB の値が知らない文字でも落とさない: 'pending' 以外の status は確定として数え、'foreman' 以外の payRole は職長以外として数える", async () => {
        recordsAre([
            { userId: 'foremanA', payRole: 'foreman', amount: 1500, status: 'confirmed' },
            { userId: 'worker1', payRole: 'FOREMAN', amount: 1500, status: 'CONFIRMED' },
            { userId: 'worker2', payRole: '', amount: 200, status: '' },
        ]);
        expect(await close('2026-09')).toEqual({ ok: true, closedAt: CLOSED_AT });
        expect((mock(prisma.allowanceLog.create).mock.calls[0][0] as { data: { detail: unknown } }).data.detail)
            .toEqual({ records: 3, people: 3, foremanDays: 1, memberDays: 2, totalAmount: 3200 });
    });

    it('順番: トランザクションの中で、鍵 → 締めてあるかを読む → その月の記録を読む → 締めた月の行を作る → 履歴（全部 tx で）', async () => {
        expect(await close('2026-09')).toEqual({ ok: true, closedAt: CLOSED_AT });
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.$executeRaw',
            'tx.allowanceMonthClose.findUnique',
            'tx.allowanceRecord.findMany',
            'tx.allowanceMonthClose.create',
            'tx.allowanceLog.create',
        ]);
    });
});

describe('reopenAllowanceMonth（締めを外す）', () => {
    it("月の形が違う → 'invalid_month'。DB には触らない（年は 2000〜2999 だけ。'0026-09' のような年も受け付けない）", async () => {
        for (const bad of ['2026-9', '2026-13', '2026-00', '202609', '2026-09-01', '', '0026-09', '1999-12', '3000-01', null, undefined, 202609, {}]) {
            expect([bad, await reopenAllowanceMonth(ADMIN, bad)]).toEqual([bad, { ok: false, reason: 'invalid_month' }]);
        }
        expect(dbCalls()).toEqual([]);
    });

    it("締めていない月（消えた件数が 1 でない）→ 'not_closed'。履歴は書かない", async () => {
        mock(prisma.allowanceMonthClose.deleteMany).mockResolvedValue({ count: 0 });
        expect(await reopenAllowanceMonth(ADMIN, '2026-09')).toEqual({ ok: false, reason: 'not_closed' });
        expect(prisma.allowanceMonthClose.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.create).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
    });

    it('締めを外す: その月の「締めた月の行」を消し、履歴を1行書く（month_reopened・外した人・月）', async () => {
        expect(await reopenAllowanceMonth(ADMIN, '2026-09')).toEqual({ ok: true });
        expect(prisma.allowanceMonthClose.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceMonthClose.deleteMany).toHaveBeenCalledWith({ where: { month: '2026-09' } });
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.create).toHaveBeenCalledWith({
            data: { action: 'month_reopened', actorId: 'admin1', actorName: '管理者1', month: '2026-09' },
        });
    });

    it('順番: トランザクションの中で、鍵 → 締めた月の行を消す → 履歴（全部 tx で）', async () => {
        expect(await reopenAllowanceMonth(ADMIN, '2026-09')).toEqual({ ok: true });
        expect(dbCalls()).toEqual(['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceMonthClose.deleteMany', 'tx.allowanceLog.create']);
    });
});

describe('loadUnclosedPastMonths（終わったのに、締めていない月）', () => {
    /** 記録のある日付（groupBy が返す行＝日付ごとに1行） */
    const recordDaysAre = (...dateKeys: string[]) => mock(prisma.allowanceRecord.groupBy).mockResolvedValue(dateKeys.map((key) => ({ date: utc0(key) })));

    it('今月（日本時間）より前の、記録のある日付を、日付ごとに1行にまとめて読む。締めた月は、全部を読む（読むだけ）', async () => {
        await loadUnclosedPastMonths('2026-10-04');
        expect(prisma.allowanceRecord.groupBy).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.groupBy).toHaveBeenCalledWith({ by: ['date'], where: { date: { lt: utc0('2026-10-01') } } });
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledWith({ select: { month: true } });
        expect(dbCalls().sort()).toEqual(['prisma.allowanceMonthClose.findMany', 'prisma.allowanceRecord.groupBy']);
    });

    it('記録があるのに締めていない月を、古い順に、重なりなく返す（締めた月は除く）', async () => {
        recordDaysAre('2026-09-30', '2026-07-01', '2026-08-15', '2026-09-01', '2026-08-20', '2025-12-31', '2026-07-31');
        closeMonths('2026-08', '2026-06');
        expect(await loadUnclosedPastMonths('2026-10-04')).toEqual(['2025-12', '2026-07', '2026-09']);
    });

    it('記録が無い・記録のある月を全部締めてあるなら、空の配列', async () => {
        expect(await loadUnclosedPastMonths('2026-10-04')).toEqual([]);
        recordDaysAre('2026-08-15', '2026-09-30');
        closeMonths('2026-08', '2026-09');
        expect(await loadUnclosedPastMonths('2026-10-04')).toEqual([]);
    });

    it('月の境目: 「今日」が月の最初の日なら、前の月までを読む。月の最後の日なら、その月はまだ読まない（年をまたぐ月も）', async () => {
        const boundaryFor = async (todayKey: string) => {
            mock(prisma.allowanceRecord.groupBy).mockClear();
            await loadUnclosedPastMonths(todayKey);
            return keyOf((mock(prisma.allowanceRecord.groupBy).mock.calls[0][0] as { where: { date: { lt: Date } } }).where.date.lt);
        };
        expect(await boundaryFor('2026-10-01')).toBe('2026-10-01');
        expect(await boundaryFor('2026-09-30')).toBe('2026-09-01');
        expect(await boundaryFor('2027-01-01')).toBe('2027-01-01');
        expect(await boundaryFor('2026-12-31')).toBe('2026-12-01');
    });

    it('「今日」を渡さなければ、日本時間の今日で決める（UTC ではまだ前の月でも、日本時間で月が変わっていれば、前の月は「終わった月」）', async () => {
        const boundary = () => keyOf((mock(prisma.allowanceRecord.groupBy).mock.calls[0][0] as { where: { date: { lt: Date } } }).where.date.lt);

        freezeNow('2026-09-30T15:30:00.000Z'); // 日本時間 10/1 0:30（UTC では 9/30）
        await loadUnclosedPastMonths();
        expect(boundary()).toBe('2026-10-01');

        mock(prisma.allowanceRecord.groupBy).mockClear();
        freezeNow('2026-09-30T14:59:00.000Z'); // 日本時間 9/30 23:59
        await loadUnclosedPastMonths();
        expect(boundary()).toBe('2026-09-01');
    });

    it('「今日」の形が違えば例外にする。DB は読まない', async () => {
        for (const bad of ['2026/10/04', '2026-13-04', '20261004', '']) {
            await expect(loadUnclosedPastMonths(bad)).rejects.toThrow('日付の形が違います');
        }
        expect(dbCalls()).toEqual([]);
    });
});

// ================================================================ 金額を変える・予約を取り消す

/** 金額の行のうち、足す・取り消すときに読む列 */
const RATE_COLUMNS = { id: true, itemId: true, foremanAmount: true, memberAmount: true, effectiveFrom: true, createdBy: true, createdByName: true, createdAt: true };

describe('addAllowanceRate（金額を変える＝金額の行を足す）', () => {
    /** 「今」は 日本時間 2026-10-04 12:00（今日は 2026-10-04）。関数の中で「今日」と「入れた日時」を決めるので、時計を固定する */
    const NOW = new Date('2026-10-04T03:00:00.000Z');
    beforeEach(() => {
        freezeNow(NOW.toISOString());
    });

    /** 管理者1 が、大規模手当に「11/1 から 職長 1,800円・職長以外 250円」を足す（今日より後＝予約） */
    const addRate = (over: Partial<AddAllowanceRateInput> = {}, itemId = 'large') =>
        addAllowanceRate(ADMIN, itemId, { foremanAmount: 1800, memberAmount: 250, effectiveFromKey: '2026-11-01', ...over });
    const ratesAre = (rows: unknown[]) => mock(prisma.allowanceRate.findMany).mockResolvedValue(rows);
    /** 適用開始日からあとの、すでに付いている記録（付け直すかを見るために読む列だけ） */
    const recordToCheck = (id: string, userId: string, dateKey: string, payRole: string, amount: number, rateId: string | null) =>
        ({ id, userId, date: utc0(dateKey), itemName: '大規模手当', payRole, amount, rateId });
    const recordsAre = (rows: unknown[]) => mock(prisma.allowanceRecord.findMany).mockResolvedValue(rows);
    /** 足した行（allowanceRate.create に渡した data。既定は、最後の呼び出し） */
    const createdData = () => {
        const calls = mock(prisma.allowanceRate.create).mock.calls;
        return (calls[calls.length - 1][0] as { data: Record<string, unknown> }).data;
    };
    /** 記録を直した呼び出し（allowanceRecord.updateMany に渡した引数。呼ばれた順） */
    const recordUpdates = () => mock(prisma.allowanceRecord.updateMany).mock.calls.map((c) => c[0] as unknown);
    /** 履歴 rate_added の detail */
    const rateAddedDetail = () => (mock(prisma.allowanceLog.create).mock.calls[0][0] as { data: { detail: Record<string, unknown> } }).data.detail;

    it('日付の形が違えば例外にする。トランザクションを開く前に断る（DB には触らない）', async () => {
        for (const bad of ['2026-02-30', '2026/11/01', '2026-11-1', '']) {
            await expect(addRate({ effectiveFromKey: bad })).rejects.toThrow('日付の形が違います');
        }
        expect(dbCalls()).toEqual([]);
    });

    it("その手当が無い → { ok: false, reason: 'not_found' }。鍵を取って、手当を読むだけ（何も足さない）", async () => {
        mock(prisma.allowanceItem.findUnique).mockResolvedValue(null);
        expect(await addRate({}, 'ghost')).toEqual({ ok: false, reason: 'not_found' });
        expect(prisma.allowanceItem.findUnique).toHaveBeenCalledWith({ where: { id: 'ghost' }, select: { id: true } });
        expect(dbCalls()).toEqual(['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceItem.findUnique']);
    });

    it('順番: トランザクションの中で、鍵 → 手当を読む → 金額の履歴を読む → 締めた月を読む → 行を足す → 記録を読む → 履歴（全部 tx で）', async () => {
        expect((await addRate()).ok).toBe(true);
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.$executeRaw',
            'tx.allowanceItem.findUnique',
            'tx.allowanceRate.findMany',
            'tx.allowanceMonthClose.findMany',
            'tx.allowanceRate.create',
            'tx.allowanceRecord.findMany',
            'tx.allowanceLog.create',
        ]);
    });

    it('読む条件: 金額の履歴は「その手当」／締めた月は「適用開始日の月からあと」／記録は「その手当の、適用開始日からあと」', async () => {
        expect((await addRate({ effectiveFromKey: '2026-09-15' })).ok).toBe(true);
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledWith({
            where: { itemId: { in: ['large'] } },
            select: { id: true, itemId: true, foremanAmount: true, memberAmount: true, effectiveFrom: true, createdAt: true },
        });
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceMonthClose.findMany).toHaveBeenCalledWith({ where: { month: { gte: '2026-09' } }, select: { month: true } });
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledWith({
            where: { itemId: 'large', date: { gte: utc0('2026-09-15') } },
            select: { id: true, userId: true, date: true, itemName: true, payRole: true, amount: true, rateId: true },
        });
    });

    it('足す行: 手当・金額・適用開始日（UTC 0時の印）・足した人と名前・入れた日時（今）', async () => {
        await addRate();
        expect(prisma.allowanceRate.create).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRate.create).toHaveBeenCalledWith({
            data: {
                itemId: 'large', foremanAmount: 1800, memberAmount: 250, effectiveFrom: utc0('2026-11-01'),
                createdBy: 'admin1', createdByName: '管理者1', createdAt: NOW,
            },
            select: RATE_COLUMNS,
        });
    });

    it('同じ適用開始日の行がすでにあれば、入れた日時を「その行の日時 + 1ミリ秒」以上にする（足した行が、必ず「あとから入れた行」になる）', async () => {
        // id は、足す行（rate-new）より大きい文字にする（入れた日時が同じだと、id の大きいほうが使われてしまうことを確かめるため）
        const sameDay = (id: string, createdAt: Date) =>
            ({ id, itemId: 'large', foremanAmount: 1700, memberAmount: 220, effectiveFrom: utc0('2026-11-01'), createdAt });
        const addOver = async (rows: unknown[]) => {
            ratesAre(rows);
            const result = await addRate();
            if (!result.ok) throw new Error(`足せるはずが、足せなかった: ${result.reason}`);
            // 足したあとの金額の履歴で、11/1 の記録に使われるのは、足した行
            expect(resolveAllowanceRateAt(result.rates, '2026-11-01')?.id).toBe('rate-new');
            return (createdData().createdAt as Date).toISOString();
        };

        // 同じ適用開始日の行が無い（ほかの適用開始日の行が、今より後の日時で入っていても）→ 今
        expect(await addOver([RATE_ROWS[0], { ...RATE_ROWS[1], createdAt: new Date('2026-10-04T05:00:00.000Z') }])).toBe('2026-10-04T03:00:00.000Z');
        // 同じ適用開始日の行が、今より前に入っている → 今
        expect(await addOver([...RATE_ROWS, sameDay('zzz-old', new Date('2026-10-01T00:00:00.000Z'))])).toBe('2026-10-04T03:00:00.000Z');
        // 同じ適用開始日の行が、今と同じ日時 → その1ミリ秒あと
        expect(await addOver([...RATE_ROWS, sameDay('zzz-old', NOW)])).toBe('2026-10-04T03:00:00.001Z');
        // 同じ適用開始日の行が2つ（今と同じ・今の 10ミリ秒あと）→ いちばんあとの行の、1ミリ秒あと
        expect(await addOver([sameDay('zzz-older', NOW), ...RATE_ROWS, sameDay('zzz-old', new Date('2026-10-04T03:00:00.010Z'))])).toBe('2026-10-04T03:00:00.011Z');
    });

    it("過去の日付で、手当の始まりの日より前 → { ok: false, reason: 'before_start', startDate: 始まりの日 }。何も足さない・履歴も書かない", async () => {
        // 始まりの日は 9/1。今日は 10/4
        expect(await addRate({ effectiveFromKey: '2026-08-31' })).toEqual({ ok: false, reason: 'before_start', startDate: '2026-09-01' });
        expect(await addRate({ effectiveFromKey: '2020-01-01' })).toEqual({ ok: false, reason: 'before_start', startDate: '2026-09-01' });
        noWrites();
    });

    it("金額の行が1つも無い手当に、過去の日付 → 'before_start'（startDate は null）。何も足さない", async () => {
        ratesAre([]);
        expect(await addRate({ effectiveFromKey: '2026-10-03' })).toEqual({ ok: false, reason: 'before_start', startDate: null });
        noWrites();
    });

    it('過去の日付でも、手当の始まりの日からあとなら足せる（始まりの日の当日も）。今日・先の日付は、始まりの日が無くても・始まりの日より前でも足せる', async () => {
        for (const key of ['2026-09-01', '2026-09-15', '2026-10-03', '2026-10-04', '2026-10-05']) {
            expect([key, (await addRate({ effectiveFromKey: key })).ok]).toEqual([key, true]);
        }
        // 金額の行が1つも無い手当（始まりの日が無い）
        ratesAre([]);
        for (const key of ['2026-10-04', '2026-11-01']) {
            expect([key, (await addRate({ effectiveFromKey: key })).ok]).toEqual([key, true]);
        }
        // 予約しか無い手当（始まりの日が、先の 11/1）に、今日の日付
        ratesAre([{ ...RATE_ROWS[0], effectiveFrom: utc0('2026-11-01') }]);
        expect((await addRate({ effectiveFromKey: '2026-10-04' })).ok).toBe(true);
    });

    it("適用開始日の月からあとに、締めた月が1つでもある → { ok: false, reason: 'closed_month', month: その中でいちばん古い月 }。何も足さない（先の日付でも同じ）", async () => {
        closeMonths('2026-10', '2026-09', '2026-08');
        expect(await addRate({ effectiveFromKey: '2026-09-15' })).toEqual({ ok: false, reason: 'closed_month', month: '2026-09' });
        closeMonths('2026-10', '2026-08');
        expect(await addRate({ effectiveFromKey: '2026-09-15' })).toEqual({ ok: false, reason: 'closed_month', month: '2026-10' });
        closeMonths('2026-12');
        expect(await addRate({ effectiveFromKey: '2026-11-01' })).toEqual({ ok: false, reason: 'closed_month', month: '2026-12' });
        noWrites();
    });

    it('適用開始日の月より前の月だけが締めてあるなら、足せる', async () => {
        closeMonths('2026-08', '2026-07');
        expect((await addRate({ effectiveFromKey: '2026-09-15' })).ok).toBe(true);
    });

    it("始まりの日より前で、締めた月もあるときは 'before_start'（始まりの日のほうを先に見る）", async () => {
        closeMonths('2026-08', '2026-09');
        expect(await addRate({ effectiveFromKey: '2026-08-15' })).toEqual({ ok: false, reason: 'before_start', startDate: '2026-09-01' });
        noWrites();
    });

    it('「今日」は日本時間で決める（UTC ではまだ前の日でも、日本時間で日付が変わっていれば、その日が今日）', async () => {
        freezeNow('2026-10-03T15:30:00.000Z'); // 日本時間 10/4 0:30（UTC では 10/3）
        ratesAre([]); // 金額の行が無いので、過去の日付は足せない・今日からは足せる
        expect(await addRate({ effectiveFromKey: '2026-10-03' })).toEqual({ ok: false, reason: 'before_start', startDate: null });
        expect(await addRate({ effectiveFromKey: '2026-10-04' })).toMatchObject({ ok: true, todayKey: '2026-10-04' });
    });

    it('「今日」と「入れた日時」は、鍵を取ったあとで決める（鍵を待っているあいだに日付が変わったら、変わったあとの日で判定する）', async () => {
        ratesAre([]);
        /** 鍵を待っているあいだに、日本時間で 10/5 になる */
        const dayChangesWhileWaitingForLock = () => mock(prisma.$executeRaw).mockImplementationOnce(async () => {
            jest.setSystemTime(new Date('2026-10-04T15:00:00.000Z'));
            return 0;
        });

        // 呼んだときは「今日」だった 10/4 が、鍵のあとでは「過去の日付」
        dayChangesWhileWaitingForLock();
        expect(await addRate({ effectiveFromKey: '2026-10-04' })).toEqual({ ok: false, reason: 'before_start', startDate: null });

        freezeNow(NOW.toISOString());
        dayChangesWhileWaitingForLock();
        expect(await addRate({ effectiveFromKey: '2026-10-05' })).toMatchObject({ ok: true, todayKey: '2026-10-05' });
        expect(createdData().createdAt).toEqual(new Date('2026-10-04T15:00:00.000Z'));
    });

    it('予約（適用開始日が今日より後）を足したとき: その日からあとの記録はまだ無いので、記録は1件も直さない。履歴は rate_added の1行だけ', async () => {
        const result = await addRate(); // 11/1 から（その日からあとの記録は無い）
        expect(result).toMatchObject({ ok: true, repriced: 0, todayKey: '2026-10-04' });
        expect(prisma.allowanceRecord.updateMany).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.create).toHaveBeenCalledWith({
            data: {
                action: 'rate_added', actorId: 'admin1', actorName: '管理者1', itemId: 'large',
                detail: { rateId: 'rate-new', foremanAmount: 1800, memberAmount: 250, effectiveFrom: '2026-11-01', repriced: 0 },
            },
        });
    });

    describe('さかのぼって金額を変えたとき（適用開始日が今日以前）: すでに付いている記録を、新しい金額の表に合わせる', () => {
        /** 9/15 から 職長 1,800円・職長以外 200円（職長の金額だけが変わる） */
        const backdate = () => addRate({ effectiveFromKey: '2026-09-15', foremanAmount: 1800, memberAmount: 200 });

        beforeEach(() => {
            recordsAre([
                recordToCheck('a', 'foremanA', '2026-09-20', 'foreman', 1500, 'rate1'), // 金額が変わる（1,500円 → 1,800円）
                recordToCheck('b', 'worker1', '2026-09-20', 'member', 200, 'rate1'),    // 金額は同じ。金額の行だけ付け替える
                recordToCheck('c', 'foremanA', '2026-09-30', 'foreman', 1500, 'rate1'), // 金額が変わる
                recordToCheck('d', 'worker1', '2026-10-02', 'member', 300, 'rate2'),    // 変わらない（10/1 からの金額のまま）
                recordToCheck('e', 'foremanA', '2026-10-02', 'foreman', 2000, 'rate2'), // 変わらない
                recordToCheck('f', 'worker2', '2026-09-16', 'member', 200, null),       // 金額の行が入っていない記録。金額の行だけ入れる
            ]);
        });

        it('金額が変わる記録と、金額の行だけ付け替える記録を直す。合わせたあとの「金額・金額の行」が同じ記録は、まとめて1回で直す。変わらない記録には触らない', async () => {
            await backdate();
            expect(recordUpdates()).toEqual([
                { where: { id: { in: ['a', 'c'] } }, data: { amount: 1800, rateId: 'rate-new' } },
                { where: { id: { in: ['b', 'f'] } }, data: { amount: 200, rateId: 'rate-new' } },
            ]);
        });

        it('返す形: 足した行・足したあとの金額の履歴・金額が変わった件数（金額の行の付け替えだけの記録は数えない）・判定に使った「今日」', async () => {
            expect(await backdate()).toEqual({
                ok: true,
                rate: {
                    id: 'rate-new', itemId: 'large', foremanAmount: 1800, memberAmount: 200, effectiveFrom: utc0('2026-09-15'),
                    createdBy: 'admin1', createdByName: '管理者1', createdAt: NOW,
                },
                rates: [...RATE_LIKES, { id: 'rate-new', foremanAmount: 1800, memberAmount: 200, effectiveFrom: '2026-09-15', createdAt: '2026-10-04T03:00:00.000Z' }],
                repriced: 2,
                todayKey: '2026-10-04',
            });
        });

        it('履歴: rate_added を1行（足した行の ID・金額・適用開始日・金額が変わった件数）と、金額が変わった記録ごとに record_repriced を1行（まとめて1回で書く）', async () => {
            await backdate();
            expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceLog.create).toHaveBeenCalledWith({
                data: {
                    action: 'rate_added', actorId: 'admin1', actorName: '管理者1', itemId: 'large',
                    detail: { rateId: 'rate-new', foremanAmount: 1800, memberAmount: 200, effectiveFrom: '2026-09-15', repriced: 2 },
                },
            });
            expect(prisma.allowanceLog.createMany).toHaveBeenCalledTimes(1);
            expect(prisma.allowanceLog.createMany).toHaveBeenCalledWith({
                data: [
                    {
                        action: 'record_repriced', actorId: 'admin1', actorName: '管理者1',
                        targetUserId: 'foremanA', itemId: 'large', recordId: 'a', recordDate: utc0('2026-09-20'),
                        detail: { itemName: '大規模手当', payRole: 'foreman', before: 1500, after: 1800, rateId: 'rate-new' },
                    },
                    {
                        action: 'record_repriced', actorId: 'admin1', actorName: '管理者1',
                        targetUserId: 'foremanA', itemId: 'large', recordId: 'c', recordDate: utc0('2026-09-30'),
                        detail: { itemName: '大規模手当', payRole: 'foreman', before: 1500, after: 1800, rateId: 'rate-new' },
                    },
                ],
            });
        });

        it('順番: 行を足す → 記録を読む → 記録を直す → 履歴 rate_added → 履歴 record_repriced（全部 tx で）', async () => {
            await backdate();
            // 記録を直すのは2回（金額ごと）。同じ名前の2回目以降は除いて、始まった順番を見る
            expect(dbCallOrder()).toEqual([
                'prisma.$transaction',
                'tx.$executeRaw',
                'tx.allowanceItem.findUnique',
                'tx.allowanceRate.findMany',
                'tx.allowanceMonthClose.findMany',
                'tx.allowanceRate.create',
                'tx.allowanceRecord.findMany',
                'tx.allowanceRecord.updateMany',
                'tx.allowanceLog.create',
                'tx.allowanceLog.createMany',
            ]);
        });
    });

    it('金額が変わった記録が無ければ（金額の行の付け替えだけなら）、record_repriced は書かない。rate_added の repriced は 0', async () => {
        recordsAre([recordToCheck('b', 'worker1', '2026-09-20', 'member', 200, 'rate1')]);
        expect(await addRate({ effectiveFromKey: '2026-09-15', foremanAmount: 1800, memberAmount: 200 })).toMatchObject({ ok: true, repriced: 0 });
        expect(recordUpdates()).toEqual([{ where: { id: { in: ['b'] } }, data: { amount: 200, rateId: 'rate-new' } }]);
        expect(prisma.allowanceLog.createMany).not.toHaveBeenCalled();
        expect(rateAddedDetail()).toMatchObject({ rateId: 'rate-new', repriced: 0 });
    });

    it('打ちまちがいの直し（すでにある行と同じ適用開始日で入れ直す）: その日からあとの記録が、入れ直した金額になる', async () => {
        // 10/1 からの金額（職長 2,000円・職長以外 300円）を、職長 2,100円に入れ直す
        recordsAre([
            recordToCheck('d', 'worker1', '2026-10-02', 'member', 300, 'rate2'),
            recordToCheck('e', 'foremanA', '2026-10-02', 'foreman', 2000, 'rate2'),
            recordToCheck('g', 'foremanB', '2026-10-03', 'foreman', 2000, 'rate2'),
        ]);
        expect(await addRate({ effectiveFromKey: '2026-10-01', foremanAmount: 2100, memberAmount: 300 })).toMatchObject({ ok: true, repriced: 2 });
        expect(recordUpdates()).toEqual([
            { where: { id: { in: ['d'] } }, data: { amount: 300, rateId: 'rate-new' } },
            { where: { id: { in: ['e', 'g'] } }, data: { amount: 2100, rateId: 'rate-new' } },
        ]);
        expect(rateAddedDetail()).toEqual({ rateId: 'rate-new', foremanAmount: 2100, memberAmount: 300, effectiveFrom: '2026-10-01', repriced: 2 });
    });

    it('合わせたあとの金額が同じでも、使う金額の行が違う記録は、別々に直す（金額の行を取り違えない）', async () => {
        // 9/15 から 職長 2,000円・職長以外 300円（10/1 からの金額と、同じ金額）
        recordsAre([
            recordToCheck('x', 'foremanA', '2026-09-20', 'foreman', 1500, 'rate1'), // 足した行（9/15 から）で 2,000円
            recordToCheck('y', 'foremanB', '2026-10-02', 'foreman', 2000, null),    // 10/1 からの行で 2,000円（金額の行が入っていなかった記録）
        ]);
        expect(await addRate({ effectiveFromKey: '2026-09-15', foremanAmount: 2000, memberAmount: 300 })).toMatchObject({ ok: true, repriced: 1 });
        expect(recordUpdates()).toEqual([
            { where: { id: { in: ['x'] } }, data: { amount: 2000, rateId: 'rate-new' } },
            { where: { id: { in: ['y'] } }, data: { amount: 2000, rateId: 'rate2' } },
        ]);
    });

    it("記録の区分は、決まった値にそろえてから合わせる（DB の値が 'foreman' 以外の知らない文字なら「職長以外」の金額。履歴の区分も 'member'）", async () => {
        recordsAre([recordToCheck('odd', 'worker1', '2026-09-20', 'FOREMAN', 1500, 'rate1')]);
        expect(await addRate({ effectiveFromKey: '2026-09-15', foremanAmount: 1800, memberAmount: 250 })).toMatchObject({ ok: true, repriced: 1 });
        expect(recordUpdates()).toEqual([{ where: { id: { in: ['odd'] } }, data: { amount: 250, rateId: 'rate-new' } }]);
        const logs = (mock(prisma.allowanceLog.createMany).mock.calls[0][0] as { data: { detail: unknown }[] }).data;
        expect(logs.map((l) => l.detail)).toEqual([{ itemName: '大規模手当', payRole: 'member', before: 1500, after: 250, rateId: 'rate-new' }]);
    });

    it('その日付に有効な金額が無い記録（どの適用開始日よりも前の日付）は、直さない', async () => {
        recordsAre([
            recordToCheck('old', 'worker1', '2026-08-31', 'member', 999, null),     // 手当の始まりの日（9/1）より前
            recordToCheck('a', 'foremanA', '2026-09-20', 'foreman', 1500, 'rate1'),
        ]);
        expect(await addRate({ effectiveFromKey: '2026-09-15', foremanAmount: 1800, memberAmount: 200 })).toMatchObject({ ok: true, repriced: 1 });
        expect(recordUpdates()).toEqual([{ where: { id: { in: ['a'] } }, data: { amount: 1800, rateId: 'rate-new' } }]);
    });
});

describe('cancelAllowanceRate（金額の予約を取り消す）', () => {
    /** 「今」は 日本時間 2026-10-04 12:00（今日は 2026-10-04）。関数の中で「今日」を決めるので、時計を固定する */
    const NOW = '2026-10-04T03:00:00.000Z';
    beforeEach(() => {
        freezeNow(NOW);
    });

    /** 取り消そうとしている金額の行（読む列だけ）。既定は「大規模手当の、11/1 からの予約」 */
    const rateRow = (over: Record<string, unknown> = {}) => ({
        id: 'rate9', itemId: 'large', foremanAmount: 2200, memberAmount: 350, effectiveFrom: utc0('2026-11-01'),
        createdBy: 'manager1', createdByName: 'マネージャー1', createdAt: new Date('2026-10-01T02:03:04.567Z'), ...over,
    });
    const rateIs = (row: unknown) => mock(prisma.allowanceRate.findUnique).mockResolvedValue(row);

    it("その金額の行が無い → 'not_found'。鍵を取って、行を読むだけ（何も消さない）", async () => {
        expect(await cancelAllowanceRate(ADMIN, 'large', 'ghost')).toBe('not_found');
        expect(prisma.allowanceRate.findUnique).toHaveBeenCalledWith({ where: { id: 'ghost' }, select: RATE_COLUMNS });
        expect(dbCalls()).toEqual(['prisma.$transaction', 'tx.$executeRaw', 'tx.allowanceRate.findUnique']);
    });

    it("ほかの手当の行 → 'not_found'（この手当の取り消しとして、ほかの手当の行を消させない）", async () => {
        rateIs(rateRow({ itemId: 'night' }));
        expect(await cancelAllowanceRate(ADMIN, 'large', 'rate9')).toBe('not_found');
        noWrites();
    });

    it("すでに始まっている（適用開始日が今日以前）→ 'started'。消さない・履歴も書かない", async () => {
        for (const key of ['2026-10-04', '2026-10-03', '2026-09-01']) {
            rateIs(rateRow({ effectiveFrom: utc0(key) }));
            expect([key, await cancelAllowanceRate(ADMIN, 'large', 'rate9')]).toEqual([key, 'started']);
        }
        noWrites();
    });

    it("まだ始まっていない予約（適用開始日が今日より後。明日でも）→ 'cancelled'。その行を消して、履歴 rate_cancelled に、消した行の全部の列を残す", async () => {
        rateIs(rateRow({ effectiveFrom: utc0('2026-10-05') }));
        expect(await cancelAllowanceRate(ADMIN, 'large', 'rate9')).toBe('cancelled');

        expect(prisma.allowanceRate.delete).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRate.delete).toHaveBeenCalledWith({ where: { id: 'rate9' } });
        expect(prisma.allowanceLog.create).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceLog.create).toHaveBeenCalledWith({
            data: {
                action: 'rate_cancelled', actorId: 'admin1', actorName: '管理者1', itemId: 'large',
                // 日付は YYYY-MM-DD・日時は ISO 文字列
                detail: {
                    id: 'rate9', itemId: 'large', foremanAmount: 2200, memberAmount: 350, effectiveFrom: '2026-10-05',
                    createdBy: 'manager1', createdByName: 'マネージャー1', createdAt: '2026-10-01T02:03:04.567Z',
                },
            },
        });
    });

    it('「今日」は日本時間で決める（UTC ではまだ前の日でも、日本時間で日付が変わっていれば、その日からの行は「始まっている」）', async () => {
        freezeNow('2026-10-03T15:30:00.000Z'); // 日本時間 10/4 0:30（UTC では 10/3）
        rateIs(rateRow({ effectiveFrom: utc0('2026-10-04') }));
        expect(await cancelAllowanceRate(ADMIN, 'large', 'rate9')).toBe('started');
        rateIs(rateRow({ effectiveFrom: utc0('2026-10-05') }));
        expect(await cancelAllowanceRate(ADMIN, 'large', 'rate9')).toBe('cancelled');
    });

    it("「今日」は、鍵を取ったあとで決める（鍵を待っているあいだに日付が変わって始まった行は、消さない → 'started'）", async () => {
        rateIs(rateRow({ effectiveFrom: utc0('2026-10-05') })); // 呼んだとき（10/4）は、まだ始まっていない
        mock(prisma.$executeRaw).mockImplementationOnce(async () => {
            jest.setSystemTime(new Date('2026-10-04T15:00:00.000Z')); // 鍵を待っているあいだに、日本時間で 10/5 になる
            return 0;
        });
        expect(await cancelAllowanceRate(ADMIN, 'large', 'rate9')).toBe('started');
        noWrites();
    });

    it('順番: トランザクションの中で、鍵 → 行を読む → 消す → 履歴（全部 tx で）', async () => {
        rateIs(rateRow());
        expect(await cancelAllowanceRate(ADMIN, 'large', 'rate9')).toBe('cancelled');
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.$executeRaw',
            'tx.allowanceRate.findUnique',
            'tx.allowanceRate.delete',
            'tx.allowanceLog.create',
        ]);
    });
});

describe('書く関数（足す・取り消す・認める・締める・締めを外す・金額を変える・予約を取り消す）は、どれも同じ鍵・同じ設定のトランザクションを使う', () => {
    it('トランザクションの設定（ALLOWANCE_TX_OPTIONS）: 空きを待つのは 5秒まで・全体は 10秒まで', () => {
        expect(ALLOWANCE_TX_OPTIONS).toEqual({ maxWait: 5000, timeout: 10000 });
    });

    it('何も書かずに終わるときでも、決まった設定でトランザクションを開き、その最初に、lockAllowanceWrites と同じ鍵を1回だけ取る', async () => {
        freezeNow('2026-10-04T03:00:00.000Z'); // 金額を変える・予約を取り消す は、関数の中で「今日」を決める
        await lockAllowanceWrites(tx);
        const [lockSql] = executedSqls();
        expect(lockSql).toContain('dandolink-allowance');

        const day = { actor: FOREMAN_A, foremanId: 'foremanA', dateKey: '2026-09-30', targetUserId: 'worker1', item: { ...ITEM, isActive: true } };
        const newRate = { foremanAmount: 1800, memberAmount: 250 };
        const writers: [string, () => Promise<unknown>][] = [
            ['記録を足す', () => addAllowanceRecords({ actor: ADMIN, item: ITEM, source: 'manual', entries: [{ userId: 'worker1', dateKey: '2026-09-30', payRole: 'member' }] })],
            ['ボタンで付ける', () => toggleAllowanceForDay({ ...day, on: true, targetPayRole: 'member' })],
            ['ボタンで取り消す（もう無い）', () => toggleAllowanceForDay({ ...day, on: false, targetPayRole: null })],
            ['ボタン（手当が見つからない）', () => toggleAllowanceForDay({ ...day, item: null, on: true, targetPayRole: null })],
            ['記録を1件取り消す（その記録が無い）', () => removeAllowanceRecord(ADMIN, 'ghost')],
            ['認める（認めてよい記録が無い）', () => confirmAllowanceRecords(ADMIN, ['ghost'])],
            ['月を締める', () => closeAllowanceMonth(ADMIN, '2026-09', '2026-10-04')],
            ['締めを外す', () => reopenAllowanceMonth(ADMIN, '2026-09')],
            ['金額を変える', () => addAllowanceRate(ADMIN, 'large', { ...newRate, effectiveFromKey: '2026-11-01' })],
            ['金額を変える（始まりの日より前なので断られる）', () => addAllowanceRate(ADMIN, 'large', { ...newRate, effectiveFromKey: '2026-08-01' })],
            ['予約を取り消す（その行が無い）', () => cancelAllowanceRate(ADMIN, 'large', 'ghost')],
        ];
        for (const [name, run] of writers) {
            jest.clearAllMocks();
            await run();
            expect([name, dbCalls().slice(0, 2)]).toEqual([name, ['prisma.$transaction', 'tx.$executeRaw']]);
            expect([name, executedSqls()]).toEqual([name, [lockSql]]);
            expect([name, transactionOptions()]).toEqual([name, [{ maxWait: 5000, timeout: 10000 }]]);
        }
    });
});

// ================================================================ 手配と見比べる

describe('loadAllowanceCrosscheck（手配と出勤簿から「付くはずの人と日」を作って、記録と見比べる）', () => {
    const LARGE = { id: 'large', constructionContent: '大規模' };
    /** 「今日」は 2026-10-04（引数で渡す。9月の手配は、全部が過去） */
    const TODAY = '2026-10-04';

    /** 日本時間のその日の 0時（＝UTC 前日15時）。手配（ProjectAssignment.date）は、この形で入っている */
    const jst0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000+09:00`);
    /** 案件（現場）。手配の行には、案件の ID と、案件の名前・工事内容が付いてくる */
    const SITE_A = { id: 'site-a', title: 'A ビル新築工事' };
    /** 手配の1件（読む列だけ）。workerIds に配列を渡したら JSON の文字にする。案件を渡さなければ SITE_A */
    const assignment = (foremanId: string, dateKey: string, workerIds: unknown[] | string | null, constructionContent: string | null = '大規模', site = SITE_A) => ({
        assignedEmployeeId: foremanId,
        date: jst0(dateKey),
        confirmedWorkerIds: Array.isArray(workerIds) ? JSON.stringify(workerIds) : workerIds,
        projectMasterId: site.id,
        projectMaster: { title: site.title, constructionContent },
    });
    const attendance = (userId: string, dateKey: string, status: string) => ({ userId, date: utc0(dateKey), status });
    const record = (id: string, userId: string, dateKey: string, payRole: string, amount: number, status: string, createdByName: string) =>
        ({ id, userId, date: utc0(dateKey), payRole, amount, status, createdByName });

    const USERS = [
        { id: 'f1', displayName: '職長1', role: 'FOREMAN2', dispatchSortOrder: 1 },
        { id: 'f2', displayName: '職長2', role: 'FOREMAN1', dispatchSortOrder: 3 },
        { id: 'w1', displayName: '作業員1', role: 'WORKER', dispatchSortOrder: 2 },
        { id: 'w2', displayName: '作業員2', role: 'worker', dispatchSortOrder: null },
        { id: 'w3', displayName: '作業員3', role: 'worker', dispatchSortOrder: 4 },
        { id: 'pm1', displayName: '協力会社の人', role: 'PARTNER_MEMBER', dispatchSortOrder: 9 },
        { id: 'x9', displayName: '記録だけの人', role: 'worker', dispatchSortOrder: 5 },
    ];

    /** 大規模手当の金額の行を1つだけにして、始まりの日（適用開始日）を決める */
    const rateFrom = (dateKey: string) => [
        { id: 'rate1', itemId: 'large', foremanAmount: 1500, memberAmount: 200, effectiveFrom: utc0(dateKey), createdAt: new Date('2026-08-20T01:00:00.000Z') },
    ];
    /** 見るものが何も無かったときの答え（金額の履歴のほかは、全部が空） */
    const nothing = (rates: unknown[]) => ({
        expected: [], unworked: [], ineligible: [], sites: [], records: [], diff: { missing: [], extra: [], mismatch: [] }, users: new Map(), rates,
    });

    const assignmentsAre = (rows: unknown[]) => mock(prisma.projectAssignment.findMany).mockResolvedValue(rows);
    const recordsAre = (rows: unknown[]) => mock(prisma.allowanceRecord.findMany).mockResolvedValue(rows);
    /** 人・出勤簿・金額のモックは「頼まれた ID の行だけ」を返すようにする（本物の DB と同じ答えになる） */
    const usersAre = (rows: { id: string }[]) =>
        mock(prisma.user.findMany).mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => rows.filter((u) => where.id.in.includes(u.id)));
    const attendanceIs = (rows: { userId: string }[]) =>
        mock(prisma.attendanceRecord.findMany).mockImplementation(async ({ where }: { where: { userId: { in: string[] } } }) => rows.filter((a) => where.userId.in.includes(a.userId)));
    const ratesAre = (rows: { itemId: string }[]) =>
        mock(prisma.allowanceRate.findMany).mockImplementation(async ({ where }: { where: { itemId: { in: string[] } } }) => rows.filter((r) => where.itemId.in.includes(r.itemId)));
    /** 人を読むときに頼んだ ID・出勤簿を読むときに頼んだ ID（並びは問わない。読んでいなければ null） */
    const askedUserIds = () => {
        const call = mock(prisma.user.findMany).mock.calls[0];
        return call ? [...(call[0] as { where: { id: { in: string[] } } }).where.id.in].sort() : null;
    };
    const askedAttendanceUserIds = () => {
        const call = mock(prisma.attendanceRecord.findMany).mock.calls[0];
        return call ? [...(call[0] as { where: { userId: { in: string[] } } }).where.userId.in].sort() : null;
    };
    /** 月の形は合っている前提で呼ぶ（null が返ったら、その場でテストを落とす）。todayKey に null を渡したら、「今日」を渡さずに呼ぶ */
    const crosscheck = async (item = LARGE, month = '2026-09', todayKey: string | null = TODAY) => {
        const check = await (todayKey === null ? loadAllowanceCrosscheck(item, month) : loadAllowanceCrosscheck(item, month, todayKey));
        if (!check) throw new Error('null が返った（月の形が違う）');
        return check;
    };
    const entryNames = (entries: { userId: string; date: string; payRole: string }[]) => entries.map((e) => `${e.date}/${e.userId}:${e.payRole}`);

    beforeEach(() => {
        usersAre(USERS);
        attendanceIs([]);
        ratesAre(RATE_ROWS); // 大規模手当の始まりは 9/1（9月の手配は、どの日も金額がある）
    });

    it("月の形が違えば null。DB は読まない（年は 2000〜2999 だけ。'0026-09' のような年も受け付けない）", async () => {
        for (const bad of ['2026-9', '2026-13', '2026-00', '202609', '2026-09-01', '', '0026-09', '1999-12', '3000-01', null, undefined, 202609, {}]) {
            expect([bad, await loadAllowanceCrosscheck(LARGE, bad, TODAY)]).toEqual([bad, null]);
        }
        expect(dbCalls()).toEqual([]);
    });

    it('読む範囲: 手配は「日本時間のその月」の、過去データ取込でない配置（2026-09 なら 2026-08-31T15:00Z 以上・2026-09-30T15:00Z 未満）。記録は「その手当・その月」を、日付の古い順 → 付けた順。金額の履歴は「その手当」の全部', async () => {
        await crosscheck();
        expect(prisma.projectAssignment.findMany).toHaveBeenCalledTimes(1);
        // 手配の行から読む列は、loadDayAssignments（「出勤簿入力」のボタン）と同じ（職長・日時・手配確定のメンバー・案件の ID・案件の名前と工事内容）
        expect(prisma.projectAssignment.findMany).toHaveBeenCalledWith({
            where: { date: { gte: new Date('2026-08-31T15:00:00.000Z'), lt: new Date('2026-09-30T15:00:00.000Z') }, isBackfilled: false },
            select: {
                assignedEmployeeId: true, date: true, confirmedWorkerIds: true, projectMasterId: true,
                projectMaster: { select: { title: true, constructionContent: true } },
            },
        });
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledTimes(1);
        // 記録は、確認待ちも含めて全部（status では絞らない）
        expect(prisma.allowanceRecord.findMany).toHaveBeenCalledWith({
            where: { itemId: 'large', date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') } },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
            select: { id: true, userId: true, date: true, payRole: true, amount: true, status: true, createdByName: true },
        });
        // 金額の履歴は、月では絞らない（その月より前に始まった金額も要る）
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.allowanceRate.findMany).toHaveBeenCalledWith({
            where: { itemId: { in: ['large'] } },
            select: { id: true, itemId: true, foremanAmount: true, memberAmount: true, effectiveFrom: true, createdAt: true },
        });

        // 12月（年をまたぐ月）・別の手当
        mock(prisma.projectAssignment.findMany).mockClear();
        mock(prisma.allowanceRecord.findMany).mockClear();
        mock(prisma.allowanceRate.findMany).mockClear();
        await crosscheck({ id: 'other', constructionContent: '大規模' }, '2026-12', '2027-01-10');
        expect(mock(prisma.projectAssignment.findMany).mock.calls[0][0].where).toEqual({
            date: { gte: new Date('2026-11-30T15:00:00.000Z'), lt: new Date('2026-12-31T15:00:00.000Z') }, isBackfilled: false,
        });
        expect(mock(prisma.allowanceRecord.findMany).mock.calls[0][0].where).toEqual({
            itemId: 'other', date: { gte: utc0('2026-12-01'), lt: utc0('2027-01-01') },
        });
        expect(mock(prisma.allowanceRate.findMany).mock.calls[0][0].where).toEqual({ itemId: { in: ['other'] } });
    });

    it('人は「手配に出てくる人 ＋ 記録に出てくる人」を、在籍かどうかを問わずに読む。出勤簿は「手配に出てくる人」の、その月の分だけを読む', async () => {
        assignmentsAre([assignment('f1', '2026-09-10', ['w1', 'w2']), assignment('f1', '2026-09-11', ['w1'])]);
        recordsAre([record('r1', 'w1', '2026-09-10', 'member', 200, 'confirmed', '職長1'), record('r2', 'x9', '2026-09-15', 'member', 200, 'pending', '記録だけの人')]);
        await crosscheck();

        expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        const userArgs = mock(prisma.user.findMany).mock.calls[0][0] as { where: { id: { in: string[] } }; select: unknown };
        // isActive では絞らない（辞めた人の、在籍中の月も数える）
        expect({ ...userArgs, where: { ...userArgs.where, id: { in: [...userArgs.where.id.in].sort() } } }).toEqual({
            where: { id: { in: ['f1', 'w1', 'w2', 'x9'] } },
            select: { id: true, displayName: true, role: true, dispatchSortOrder: true },
        });

        expect(prisma.attendanceRecord.findMany).toHaveBeenCalledTimes(1);
        const attendanceArgs = mock(prisma.attendanceRecord.findMany).mock.calls[0][0] as { where: { userId: { in: string[] }; date: unknown }; select: unknown };
        expect({ ...attendanceArgs, where: { ...attendanceArgs.where, userId: { in: [...attendanceArgs.where.userId.in].sort() } } }).toEqual({
            where: { userId: { in: ['f1', 'w1', 'w2'] }, date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') } },
            select: { userId: true, date: true, status: true },
        });

        // 読むだけ（トランザクションも鍵も使わない・何も書かない）。
        // 手配・記録・金額の履歴を先に読み、そのあとで、出てくる人と出勤簿を読む
        const calls = dbCalls();
        expect(calls.slice(0, 3).sort()).toEqual(['prisma.allowanceRate.findMany', 'prisma.allowanceRecord.findMany', 'prisma.projectAssignment.findMany']);
        expect(calls.slice(3).sort()).toEqual(['prisma.attendanceRecord.findMany', 'prisma.user.findMany']);
    });

    it('返す形: expected・unworked・ineligible・sites・records・diff（missing・extra・mismatch）・users・rates', async () => {
        assignmentsAre([
            assignment('f1', '2026-09-10', ['w1', 'w2', 'pm1', 'ghost'], 'large_scale'), // 工事内容が旧い値の案件
            assignment('f1', '2026-09-11', ['w1']),
        ]);
        attendanceIs([
            attendance('f1', '2026-09-10', 'present'), attendance('w1', '2026-09-10', 'night_shift'), attendance('w2', '2026-09-10', 'paid_leave'),
            attendance('pm1', '2026-09-10', 'present'), attendance('ghost', '2026-09-10', 'present'),
            attendance('f1', '2026-09-11', 'holiday_work'), // 9/11 の 作業員1 は、出勤簿が無い
        ]);
        recordsAre([
            record('r1', 'f1', '2026-09-10', 'foreman', 1500, 'confirmed', '職長1'),    // 合っている
            record('r2', 'w1', '2026-09-10', 'foreman', 1500, 'confirmed', '管理者1'),  // 区分が違う（手配では職長以外）
            record('r3', 'w2', '2026-09-10', 'member', 200, 'confirmed', '職長1'),     // 手配には入っているが、出勤簿が有給
            record('r4', 'pm1', '2026-09-10', 'member', 200, 'confirmed', '職長1'),    // 手配には入っているが、手当の対象外の人（協力会社のメンバー）
            record('r5', 'x9', '2026-09-15', 'member', 200, 'pending', '記録だけの人'), // 手配に入っていない
        ]);

        const check = await crosscheck();

        // 出勤簿が「働いた」（出勤・夜勤・休日出勤）の日だけ。日付の古い順 → 人の ID 順
        expect(check.expected).toEqual([
            { userId: 'f1', date: '2026-09-10', payRole: 'foreman' },
            { userId: 'w1', date: '2026-09-10', payRole: 'member' },
            { userId: 'f1', date: '2026-09-11', payRole: 'foreman' },
        ]);
        expect(check.unworked).toEqual([
            { userId: 'w2', date: '2026-09-10', payRole: 'member', attendanceStatus: 'paid_leave' },
            { userId: 'w1', date: '2026-09-11', payRole: 'member', attendanceStatus: null },
        ]);
        // 手配には入っているが、手当の対象外の人（協力会社のメンバー・User の行が無い人）。出勤していても、expected には入れない
        expect(check.ineligible).toEqual([
            { userId: 'ghost', date: '2026-09-10', payRole: 'member' },
            { userId: 'pm1', date: '2026-09-10', payRole: 'member' },
        ]);
        // 対象として数えた現場（案件の ID・名前・手配のある日数）
        expect(check.sites).toEqual([{ projectMasterId: 'site-a', title: 'A ビル新築工事', days: 2 }]);
        const r1 = { id: 'r1', userId: 'f1', date: '2026-09-10', payRole: 'foreman', amount: 1500, status: 'confirmed', createdByName: '職長1' };
        const r2 = { id: 'r2', userId: 'w1', date: '2026-09-10', payRole: 'foreman', amount: 1500, status: 'confirmed', createdByName: '管理者1' };
        const r3 = { id: 'r3', userId: 'w2', date: '2026-09-10', payRole: 'member', amount: 200, status: 'confirmed', createdByName: '職長1' };
        const r4 = { id: 'r4', userId: 'pm1', date: '2026-09-10', payRole: 'member', amount: 200, status: 'confirmed', createdByName: '職長1' };
        const r5 = { id: 'r5', userId: 'x9', date: '2026-09-15', payRole: 'member', amount: 200, status: 'pending', createdByName: '記録だけの人' };
        expect(check.records).toEqual([r1, r2, r3, r4, r5]);
        expect(check.diff).toEqual({
            missing: [{ userId: 'f1', date: '2026-09-11', payRole: 'foreman' }],
            extra: [{ record: r3, reason: 'not_worked' }, { record: r4, reason: 'not_eligible' }, { record: r5, reason: 'no_assignment' }],
            mismatch: [{ record: r2, expectedPayRole: 'member' }],
        });
        // 出てくる人の名前と、人の並びに使う順番。記録にしか出てこない人（x9）も入る。User の行が無い人（ghost）は入らない
        expect(check.users).toBeInstanceOf(Map);
        expect(Object.fromEntries(check.users)).toEqual({
            f1: { displayName: '職長1', dispatchSortOrder: 1 },
            w1: { displayName: '作業員1', dispatchSortOrder: 2 },
            w2: { displayName: '作業員2', dispatchSortOrder: null },
            pm1: { displayName: '協力会社の人', dispatchSortOrder: 9 },
            x9: { displayName: '記録だけの人', dispatchSortOrder: 5 },
        });
        // その手当の金額の履歴（付けたときの金額を出すのに使う。日付は YYYY-MM-DD・日時は ISO 文字列）
        expect(check.rates).toEqual(RATE_LIKES);
        expect(Object.keys(check).sort()).toEqual(['diff', 'expected', 'ineligible', 'rates', 'records', 'sites', 'unworked', 'users']);
    });

    it('rates: その手当の金額の履歴だけを返す（ほかの手当の金額は入らない。金額の行が無い手当は、空の配列）', async () => {
        ratesAre([
            ...RATE_ROWS,
            { id: 'night1', itemId: 'night', foremanAmount: 800, memberAmount: 500, effectiveFrom: utc0('2026-09-15'), createdAt: new Date('2026-09-10T01:00:00.000Z') },
        ]);
        expect((await crosscheck()).rates).toEqual(RATE_LIKES);
        expect((await crosscheck({ id: 'night', constructionContent: '大規模' })).rates).toEqual([
            { id: 'night1', foremanAmount: 800, memberAmount: 500, effectiveFrom: '2026-09-15', createdAt: '2026-09-10T01:00:00.000Z' },
        ]);
        expect((await crosscheck({ id: 'none', constructionContent: '大規模' })).rates).toEqual([]);
    });

    it('手当が始まる前の日（その日付に有効な金額が無い日）の手配は見ない。始まりの日の当日からは見る（「今日」ではなく、手配の日付で決める）', async () => {
        ratesAre(rateFrom('2026-09-10')); // 大規模手当の始まりを 9/10 にする（「今日」は 10/4）
        assignmentsAre([assignment('f1', '2026-09-09', ['w1', 'pm1']), assignment('f2', '2026-09-10', ['w3'])]);
        attendanceIs([
            attendance('f1', '2026-09-09', 'present'), attendance('w1', '2026-09-09', 'present'),
            attendance('f2', '2026-09-10', 'present'), // 9/10 の 作業員3 は、出勤簿が無い
        ]);

        const check = await crosscheck();
        // 9/9 の手配は、出勤していても expected にも unworked にも ineligible にも入らない（付けられない日なので、「付いていない」にも出ない）
        expect(entryNames(check.expected)).toEqual(['2026-09-10/f2:foreman']);
        expect(entryNames(check.unworked)).toEqual(['2026-09-10/w3:member']);
        expect(check.ineligible).toEqual([]);
        expect(entryNames(check.diff.missing)).toEqual(['2026-09-10/f2:foreman']);
        // 始まる前の日の手配の人は、人も出勤簿も読まない
        expect([askedUserIds(), askedAttendanceUserIds()]).toEqual([['f2', 'w3'], ['f2', 'w3']]);
    });

    it('その月より前に始まった金額も、その月の手配に使う（始まりが 8/1 なら、9月の手配は、月の最初の日から見る）', async () => {
        ratesAre(rateFrom('2026-08-01'));
        assignmentsAre([assignment('f1', '2026-09-01', []), assignment('f1', '2026-09-30', [])]);
        const check = await crosscheck();
        expect(entryNames(check.unworked)).toEqual(['2026-09-01/f1:foreman', '2026-09-30/f1:foreman']);
        expect(check.rates).toEqual([{ id: 'rate1', foremanAmount: 1500, memberAmount: 200, effectiveFrom: '2026-08-01', createdAt: '2026-08-20T01:00:00.000Z' }]);
    });

    it('月の全部が、手当が始まる前（始まりは 9/1 で、見るのは 8月）なら、どの手配も見ない。人も出勤簿も読まない', async () => {
        assignmentsAre([assignment('f1', '2026-08-28', ['w1']), assignment('f1', '2026-08-31', ['w1'])]);
        const check = await crosscheck(LARGE, '2026-08');
        expect(check).toEqual(nothing(RATE_LIKES));
        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });

    it('金額の行が1つも無い手当は、どの手配も見ない（人も出勤簿も読まない。rates は空の配列）', async () => {
        ratesAre([]);
        assignmentsAre([assignment('f1', '2026-09-10', ['w1']), assignment('f2', '2026-09-11', ['w3'])]);
        attendanceIs([attendance('f1', '2026-09-10', 'present'), attendance('w1', '2026-09-10', 'present')]);

        const check = await crosscheck();
        expect(check).toEqual(nothing([]));
        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });

    it('対象の工事内容の手配だけを見る（旧い値 large_scale・前後の空白も「大規模」として拾う。手当側が旧い値でも同じ）', async () => {
        assignmentsAre([
            assignment('f1', '2026-09-01', [], 'large_scale'),
            assignment('f1', '2026-09-02', [], '大規模'),
            assignment('f1', '2026-09-03', [], ' 大規模 '),
            assignment('f1', '2026-09-04', [], '改修'),       // 別の工事内容
            assignment('f1', '2026-09-05', [], 'renovation'), // 別の工事内容（旧い値）
            assignment('f1', '2026-09-06', [], null),         // 未設定
            assignment('f1', '2026-09-07', [], ''),           // 未設定
            { ...assignment('f1', '2026-09-08', []), projectMaster: null }, // 案件が読めない配置
        ]);
        attendanceIs(['01', '02', '03', '04', '05', '06', '07', '08'].map((d) => attendance('f1', `2026-09-${d}`, 'present')));

        for (const item of [LARGE, { id: 'large', constructionContent: 'large_scale' }, { id: 'large', constructionContent: ' 大規模 ' }]) {
            const check = await crosscheck(item);
            expect([item.constructionContent, entryNames(check.expected)]).toEqual([
                item.constructionContent, ['2026-09-01/f1:foreman', '2026-09-02/f1:foreman', '2026-09-03/f1:foreman'],
            ]);
            expect(check.unworked).toEqual([]);
        }
    });

    it('別の工事内容・未設定の手配しか無ければ、その手配の人も出勤簿も読まない', async () => {
        assignmentsAre([
            assignment('f1', '2026-09-10', ['w1'], '改修'),
            assignment('f2', '2026-09-10', ['w2'], null),
            { ...assignment('f2', '2026-09-11', ['w3']), projectMaster: null },
        ]);
        const check = await crosscheck();
        expect(check).toEqual(nothing(RATE_LIKES));
        expect(dbCalls().sort()).toEqual(['prisma.allowanceRate.findMany', 'prisma.allowanceRecord.findMany', 'prisma.projectAssignment.findMany']);
    });

    it('手当の対象の工事内容が空なら、どの手配も対象にしない（工事内容が未設定の手配を「同じ」とみなさない）', async () => {
        assignmentsAre([assignment('f1', '2026-09-10', ['w1'], null), assignment('f1', '2026-09-11', ['w1'], ''), assignment('f1', '2026-09-12', ['w1'])]);
        attendanceIs([attendance('f1', '2026-09-10', 'present'), attendance('w1', '2026-09-10', 'present')]);
        for (const empty of ['', '   ']) {
            const check = await crosscheck({ id: 'large', constructionContent: empty });
            expect([check.expected, check.unworked, check.ineligible, check.sites]).toEqual([[], [], [], []]);
        }
        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });

    it('手配の日時（UTC 前日15時）は、日本時間の日付にする（2026-09-09T15:00:00Z の手配は 9/10。出勤簿・記録とは 9/10 で突き合わせる）', async () => {
        assignmentsAre([{ ...assignment('f1', '2026-09-10', ['w1']), date: new Date('2026-09-09T15:00:00.000Z') }]);
        attendanceIs([
            attendance('f1', '2026-09-10', 'present'),
            attendance('w1', '2026-09-09', 'present'), // 作業員1 は 9/9 に出勤、9/10 は欠勤
            attendance('w1', '2026-09-10', 'absent'),
        ]);
        recordsAre([record('r1', 'f1', '2026-09-10', 'foreman', 1500, 'confirmed', '職長1')]);

        const check = await crosscheck();
        expect(entryNames(check.expected)).toEqual(['2026-09-10/f1:foreman']);
        expect(check.unworked).toEqual([{ userId: 'w1', date: '2026-09-10', payRole: 'member', attendanceStatus: 'absent' }]);
        expect(check.diff).toEqual({ missing: [], extra: [], mismatch: [] });
        // このファイルの jst0() も同じ形（日本時間 0時 = UTC 前日15時）
        expect(jst0('2026-09-10').toISOString()).toBe('2026-09-09T15:00:00.000Z');
    });

    it('月の最初の日・最後の日の手配も、日本時間の日付で、その月の日として数える', async () => {
        assignmentsAre([
            { ...assignment('f1', '2026-09-01', null), date: new Date('2026-08-31T15:00:00.000Z') }, // 9/1
            { ...assignment('f1', '2026-09-30', null), date: new Date('2026-09-29T15:00:00.000Z') }, // 9/30
        ]);
        attendanceIs([attendance('f1', '2026-09-01', 'present'), attendance('f1', '2026-09-30', 'present')]);
        const check = await crosscheck();
        expect(entryNames(check.expected)).toEqual(['2026-09-01/f1:foreman', '2026-09-30/f1:foreman']);
        expect(check.unworked).toEqual([]);
    });

    it('先の日付（todayKey より後）の手配は見ない。今日の手配は見る', async () => {
        assignmentsAre([assignment('f1', '2026-09-10', ['w1']), assignment('f2', '2026-09-11', ['w3', 'pm1'])]);

        // 「今日」が 9/10 → 9/11 の手配は先の日付なので、その人も出勤簿も読まない
        const today10 = await crosscheck(LARGE, '2026-09', '2026-09-10');
        expect(entryNames(today10.unworked)).toEqual(['2026-09-10/f1:foreman', '2026-09-10/w1:member']);
        expect(today10.ineligible).toEqual([]);
        expect([askedUserIds(), askedAttendanceUserIds()]).toEqual([['f1', 'w1'], ['f1', 'w1']]);

        // 「今日」が 9/11 → 9/11 の手配も見る
        const today11 = await crosscheck(LARGE, '2026-09', '2026-09-11');
        expect(entryNames(today11.unworked)).toEqual(['2026-09-10/f1:foreman', '2026-09-10/w1:member', '2026-09-11/f2:foreman', '2026-09-11/w3:member']);
        expect(entryNames(today11.ineligible)).toEqual(['2026-09-11/pm1:member']);

        // 「今日」が 9/9 → どの手配も見ない
        const today9 = await crosscheck(LARGE, '2026-09', '2026-09-09');
        expect([today9.expected, today9.unworked, today9.ineligible]).toEqual([[], [], []]);
    });

    it('「今日」を渡さなければ、日本時間の今日で決める（UTC ではまだ前の日でも、日本時間の今日の手配は見る）', async () => {
        assignmentsAre([assignment('f1', '2026-09-10', ['w1']), assignment('f2', '2026-09-11', ['w3'])]);

        freezeNow('2026-09-09T15:30:00.000Z'); // 日本時間 9/10 0:30（UTC では 9/9）
        expect(entryNames((await crosscheck(LARGE, '2026-09', null)).unworked)).toEqual(['2026-09-10/f1:foreman', '2026-09-10/w1:member']);

        freezeNow('2026-09-09T14:59:00.000Z'); // 日本時間 9/9 23:59
        expect((await crosscheck(LARGE, '2026-09', null)).unworked).toEqual([]);
    });

    it('手当をもらえるロールの人だけを数える（DB の大文字のロールでも対象）。協力会社・協力会社のメンバー・税理士・応援・User の行が無い人は ineligible（対象外）に入れる', async () => {
        const users = [
            { id: 'f1', displayName: '職長1', role: 'FOREMAN2', dispatchSortOrder: 1 },
            { id: 'f2', displayName: '職長2', role: 'FOREMAN1', dispatchSortOrder: 2 },
            { id: 'w1', displayName: '作業員1', role: 'WORKER', dispatchSortOrder: 3 },
            { id: 'w2', displayName: '作業員2', role: 'worker', dispatchSortOrder: 4 },
            { id: 'mg1', displayName: 'マネージャー', role: 'MANAGER', dispatchSortOrder: 5 },
            { id: 'ad1', displayName: '管理者', role: 'Admin', dispatchSortOrder: 6 },
            { id: 'p1', displayName: '協力会社', role: 'PARTNER', dispatchSortOrder: 7 },
            { id: 'pm1', displayName: '協力会社の人', role: 'PARTNER_MEMBER', dispatchSortOrder: 8 },
            { id: 'ac1', displayName: '税理士', role: 'ACCOUNTANT', dispatchSortOrder: 9 },
            { id: 'sp1', displayName: '応援', role: 'SUPPORT', dispatchSortOrder: 10 },
        ];
        usersAre(users);
        const workerIds = ['w1', 'w2', 'mg1', 'ad1', 'p1', 'pm1', 'ac1', 'sp1', 'ghost'];
        assignmentsAre([assignment('f1', '2026-09-10', workerIds), assignment('f2', '2026-09-10', []), assignment('p1', '2026-09-11', ['w1'])]);
        attendanceIs(['f1', 'f2', ...workerIds].map((id) => attendance(id, '2026-09-10', 'present')));

        const check = await crosscheck();
        expect(entryNames(check.expected)).toEqual([
            '2026-09-10/ad1:member', '2026-09-10/f1:foreman', '2026-09-10/f2:foreman', '2026-09-10/mg1:member', '2026-09-10/w1:member', '2026-09-10/w2:member',
        ]);
        // 協力会社が職長の手配（9/11）: 協力会社は対象外。その班に入った作業員1 は対象（出勤簿が無いので unworked）
        expect(entryNames(check.unworked)).toEqual(['2026-09-11/w1:member']);
        // 対象外の人は、出勤していても ineligible（区分は、手配で決まる区分のまま）
        expect(entryNames(check.ineligible)).toEqual([
            '2026-09-10/ac1:member', '2026-09-10/ghost:member', '2026-09-10/p1:member', '2026-09-10/pm1:member', '2026-09-10/sp1:member', '2026-09-11/p1:foreman',
        ]);
    });

    it("ineligible は、日付の古い順 → 人の ID 順。その人の記録は、出勤簿がどうであっても extra の 'not_eligible'（手配に入っていない日の記録は 'no_assignment'）", async () => {
        assignmentsAre([
            assignment('f1', '2026-09-11', ['pm1', 'w1']),
            assignment('pm1', '2026-09-10', ['ghost', 'w1']), // 協力会社のメンバーが職長になっている班
        ]);
        attendanceIs([
            attendance('pm1', '2026-09-10', 'present'), attendance('ghost', '2026-09-10', 'present'), attendance('w1', '2026-09-10', 'present'),
            attendance('f1', '2026-09-11', 'present'), attendance('w1', '2026-09-11', 'present'), // 9/11 の協力会社の人は、出勤簿が無い
        ]);
        recordsAre([
            record('r1', 'pm1', '2026-09-10', 'foreman', 1500, 'confirmed', '管理者1'), // 対象外の人（その日は出勤している）
            record('r2', 'pm1', '2026-09-11', 'member', 200, 'confirmed', '職長1'),    // 対象外の人（その日は出勤簿が無い）
            record('r3', 'pm1', '2026-09-12', 'member', 200, 'confirmed', '管理者1'),  // 対象外の人の、手配に入っていない日
        ]);

        const check = await crosscheck();
        expect(check.ineligible).toEqual([
            { userId: 'ghost', date: '2026-09-10', payRole: 'member' },
            { userId: 'pm1', date: '2026-09-10', payRole: 'foreman' },
            { userId: 'pm1', date: '2026-09-11', payRole: 'member' },
        ]);
        // 対象外の人は、expected にも unworked にも入らない（出勤簿が無い日でも unworked にしない）
        expect(entryNames(check.expected)).toEqual(['2026-09-10/w1:member', '2026-09-11/f1:foreman', '2026-09-11/w1:member']);
        expect(check.unworked).toEqual([]);
        expect(check.diff.extra.map((x) => `${x.record.id}:${x.reason}`)).toEqual(['r1:not_eligible', 'r2:not_eligible', 'r3:no_assignment']);
        expect(check.diff.mismatch).toEqual([]);
    });

    describe('sites（対象として数えた現場）', () => {
        const site = (id: string, title: string) => ({ id, title });

        it('days は、その案件の、対象として数えた手配がある日付の数（日本時間の日付。同じ日に2つの班が入っていても1日）。だれも出勤していなくても・手当の対象外の人だけの班でも数える', async () => {
            assignmentsAre([
                assignment('f1', '2026-09-10', ['w1']),
                assignment('f2', '2026-09-10', ['w3']),                                                      // 同じ日・同じ案件に、もう1つの班
                { ...assignment('f2', '2026-09-10', ['w2']), date: new Date('2026-09-10T00:00:00.000Z') },  // 同じ日（日本時間 9/10 の 9:00。UTC の日付では、上の2件と別の日になる）
                assignment('f1', '2026-09-12', ['w1'], 'large_scale'),
                assignment('pm1', '2026-09-14', []),                                                         // 手当の対象外の人だけの班
            ]);
            const check = await crosscheck();
            // 9/10・9/12・9/14 の3日
            expect(check.sites).toEqual([{ projectMasterId: 'site-a', title: 'A ビル新築工事', days: 3 }]);
            // 出勤簿が無いので、付くはずの人はいない（それでも、現場は数える）
            expect(check.expected).toEqual([]);
        });

        it('並び: 日数の多い順 → 名前の順 → 案件の ID の順（手配を読んだ順ではない。名前が同じでも、案件が別なら別の行）', async () => {
            assignmentsAre([
                assignment('f1', '2026-09-01', [], '大規模', site('s5', 'C 病院増築')),   // 1日
                assignment('f1', '2026-09-02', [], '大規模', site('s4', 'B 団地')),       // 2日
                assignment('f1', '2026-09-03', [], '大規模', site('s4', 'B 団地')),
                assignment('f2', '2026-09-02', [], '大規模', site('s3', 'B 団地')),       // 2日。名前が同じ、別の案件
                assignment('f2', '2026-09-03', [], '大規模', site('s3', 'B 団地')),
                assignment('f1', '2026-09-04', [], '大規模', site('s9', 'A ビル新築')),   // 2日
                assignment('f1', '2026-09-05', [], '大規模', site('s9', 'A ビル新築')),
                assignment('f1', '2026-09-06', [], '大規模', site('s1', 'D 倉庫')),       // 3日
                assignment('f1', '2026-09-07', [], '大規模', site('s1', 'D 倉庫')),
                assignment('f1', '2026-09-08', [], '大規模', site('s1', 'D 倉庫')),
            ]);
            expect((await crosscheck()).sites).toEqual([
                { projectMasterId: 's1', title: 'D 倉庫', days: 3 },
                { projectMasterId: 's9', title: 'A ビル新築', days: 2 },
                { projectMasterId: 's3', title: 'B 団地', days: 2 },
                { projectMasterId: 's4', title: 'B 団地', days: 2 },
                { projectMasterId: 's5', title: 'C 病院増築', days: 1 },
            ]);
        });

        it('数えない手配: 別の工事内容・手当が始まる前の日（その日付に有効な金額が無い日）・先の日付（todayKey より後）。数える手配が1つも無い案件は、一覧に出さない', async () => {
            ratesAre(rateFrom('2026-09-10')); // 大規模手当の始まりは 9/10
            assignmentsAre([
                assignment('f1', '2026-09-09', ['w1']),                                          // 始まる前の日 → 数えない
                assignment('f1', '2026-09-10', ['w1']),                                          // 始まりの日 → 数える
                assignment('f1', '2026-09-20', ['w1']),                                          // 今日 → 数える
                assignment('f1', '2026-09-21', ['w1']),                                          // 先の日付 → 数えない
                assignment('f2', '2026-09-15', ['w3'], '改修', site('site-b', 'B 邸改修')),       // 別の工事内容 → 出さない
                assignment('f2', '2026-09-05', ['w3'], '大規模', site('site-c', 'C 病院増築')),   // 始まる前の日だけの案件 → 出さない
                assignment('f2', '2026-09-25', ['w3'], '大規模', site('site-d', 'D 倉庫')),       // 先の日付だけの案件 → 出さない
            ]);
            expect((await crosscheck(LARGE, '2026-09', '2026-09-20')).sites).toEqual([{ projectMasterId: 'site-a', title: 'A ビル新築工事', days: 2 }]);
        });

        it('対象の手配が無い月は、空の配列', async () => {
            expect((await crosscheck()).sites).toEqual([]);
        });
    });

    it('records: 日付は YYYY-MM-DD。payRole・status は決まった値にそろえる（知らない値は「職長以外」「確定」）', async () => {
        recordsAre([
            record('a', 'w1', '2026-09-01', 'foreman', 1500, 'pending', '作業員1'),
            record('b', 'w1', '2026-09-02', 'FOREMAN', 1500, 'PENDING', '管理者1'),
            record('c', 'w1', '2026-09-03', '', 200, '', ''),
        ]);
        const check = await crosscheck();
        expect(check.records).toEqual([
            { id: 'a', userId: 'w1', date: '2026-09-01', payRole: 'foreman', amount: 1500, status: 'pending', createdByName: '作業員1' },
            { id: 'b', userId: 'w1', date: '2026-09-02', payRole: 'member', amount: 1500, status: 'confirmed', createdByName: '管理者1' },
            { id: 'c', userId: 'w1', date: '2026-09-03', payRole: 'member', amount: 200, status: 'confirmed', createdByName: '' },
        ]);
    });

    it('手配に出てくる人がいなければ、出勤簿を読まない（記録に出てくる人の名前は読む。その記録は「手配に入っていない」）', async () => {
        recordsAre([record('r1', 'x9', '2026-09-15', 'member', 200, 'confirmed', '管理者1')]);
        const check = await crosscheck();

        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
        expect(askedUserIds()).toEqual(['x9']);
        expect([check.expected, check.unworked]).toEqual([[], []]);
        expect(check.diff.extra.map((x) => `${x.record.id}:${x.reason}`)).toEqual(['r1:no_assignment']);
        expect(Object.fromEntries(check.users)).toEqual({ x9: { displayName: '記録だけの人', dispatchSortOrder: 5 } });
    });

    it('手配も記録も無い月は、人も出勤簿も読まない（金額の履歴のほかは、全部が空）', async () => {
        const check = await crosscheck();
        expect(check).toEqual(nothing(RATE_LIKES));
        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });

    it('confirmedWorkerIds が null・空文字でも落ちない。配列の中の、空の ID・文字列でない値（数・null・真偽・配列・オブジェクト）は捨てる。職長の ID が空の配置でも落ちない', async () => {
        assignmentsAre([
            assignment('f1', '2026-09-10', null),
            assignment('f1', '2026-09-11', ''),
            assignment('f1', '2026-09-12', ['', 'w1', null, 5, true, ['w3'], { id: 'w3' }]),
            assignment('', '2026-09-13', ['w2']),
        ]);
        const check = await crosscheck();
        expect([askedUserIds(), askedAttendanceUserIds()]).toEqual([['f1', 'w1', 'w2'], ['f1', 'w1', 'w2']]);
        // 出勤簿が無いので、全部が unworked
        expect(entryNames(check.unworked)).toEqual([
            '2026-09-10/f1:foreman', '2026-09-11/f1:foreman', '2026-09-12/f1:foreman', '2026-09-12/w1:member', '2026-09-13/w2:member',
        ]);
        expect(check.expected).toEqual([]);
    });

    it("confirmedWorkerIds が配列でない JSON（'null'・'{}'・'5'・'\"abc\"' など）でも落ちない。メンバーなしとして扱う（職長だけを数える）", async () => {
        const notArrays = ['null', '{}', '5', '"abc"', 'true', '{"0":"w1","length":1}'];
        assignmentsAre(notArrays.map((json, i) => assignment('f1', `2026-09-1${i}`, json)));
        attendanceIs([attendance('f1', '2026-09-10', 'present')]);

        const check = await crosscheck();
        // 文字（"abc"）を1文字ずつの ID として読んだり、オブジェクトの中身を ID として読んだりしない
        expect([askedUserIds(), askedAttendanceUserIds()]).toEqual([['f1'], ['f1']]);
        expect(entryNames(check.expected)).toEqual(['2026-09-10/f1:foreman']);
        expect(entryNames(check.unworked)).toEqual([
            '2026-09-11/f1:foreman', '2026-09-12/f1:foreman', '2026-09-13/f1:foreman', '2026-09-14/f1:foreman', '2026-09-15/f1:foreman',
        ]);
    });
});
