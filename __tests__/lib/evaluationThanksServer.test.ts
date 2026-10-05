/**
 * @jest-environment node
 *
 * lib/evaluationThanksServer.ts（評価ポイント「ありがとう」: DB を読む・書く側）のテスト。
 *
 * @/lib/prisma は jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * だから「絞り込みが正しいか」「何を書いたか」は、DB の関数に渡した引数で確かめる。
 *
 * トランザクションの中かどうかの見分け方（__tests__/lib/allowancesServer.test.ts と同じ）:
 *   このファイルでは、$transaction の callback に「prisma と同じモック関数を持つ、別のオブジェクト（tx）」を渡す。
 *   どちらから呼ばれたか（mock.contexts）と、呼ばれた順番（mock.invocationCallOrder）を dbCalls() で一覧にする。
 *
 * 「今日」は時計を固定して決める（2026-10-05T16:00Z ＝ 日本時間 10/6 の 1時。UTC の日付と日本時間の日付が違う時刻）。
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PointActor } from '@/lib/evaluationPointsServer';
import type { Period } from '@/lib/evaluationPointsReport';
import {
    THANKS_TX_OPTIONS,
    getThanksSetting,
    loadMyThanks,
    loadThanksList,
    loadThanksSendContext,
    removeThanks,
    sendThanks,
    updateThanksSetting,
} from '@/lib/evaluationThanksServer';

// ================================================================ 土台

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

const prismaMock = prisma as unknown as Record<string, unknown>;
const isModel = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const txMock: Record<string, unknown> = Object.fromEntries(
    Object.entries(prismaMock).map(([name, value]) => [name, isModel(value) ? { ...value } : value]),
);
const tx = txMock as unknown as Prisma.TransactionClient;

const ownerNames = new Map<unknown, string>([[prismaMock, 'prisma'], [txMock, 'tx']]);
for (const [name, value] of Object.entries(prismaMock)) {
    if (!isModel(value)) continue;
    ownerNames.set(value, `prisma.${name}`);
    ownerNames.set(txMock[name], `tx.${name}`);
}

/** これまでに呼ばれた DB の操作を、呼ばれた順に並べた名前の一覧（例: ['prisma.$transaction', 'tx.$executeRaw', ...]） */
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

const executedSqls = (): string[] =>
    mock(prisma.$executeRaw).mock.calls.map((args: unknown[]) => {
        const [strings, ...values] = args as [string[], ...unknown[]];
        return strings.map((s, i) => s + (i < values.length ? String(values[i]) : '')).join('');
    });

const noWrites = () =>
    expect(dbCalls().filter((name) => /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$/.test(name))).toEqual([]);

const freezeNow = (iso: string) =>
    jest.useFakeTimers({
        now: new Date(iso),
        doNotFake: [
            'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
            'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
            'setTimeout', 'clearTimeout',
        ],
    });

/** 2026-10-05T16:00Z ＝ 日本時間 2026-10-06 01:00 */
const NOW = '2026-10-05T16:00:00.000Z';
const TODAY = '2026-10-06';

const ADMIN: PointActor = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER: PointActor = { id: 'manager1', role: 'manager', name: 'マネージャー1' };
const FOREMAN_A: PointActor = { id: 'foremanA', role: 'foreman1', name: '職長A' };
const FOREMAN_B: PointActor = { id: 'foremanB', role: 'foreman2', name: '職長B' };
const WORKER: PointActor = { id: 'worker1', role: 'worker', name: '作業員1' };

const settingIs = (row: { isActive: boolean; pointsPerThanks: number } | null) =>
    mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue(row);
const sentTodayIs = (toIds: string[]) =>
    mock(prisma.evaluationPointThanks.findMany).mockResolvedValue(toIds.map((toUserId) => ({ toUserId })));
const recipientIs = (row: { id: string; displayName: string; role: string; isActive: boolean } | null) =>
    mock(prisma.user.findUnique).mockResolvedValue(row);

const thanksRow = (over: Record<string, unknown> = {}) => ({
    id: 't1', fromUserId: 'foremanA', toUserId: 'worker1', date: utc0(TODAY), message: 'ありがとう', points: 2,
    createdAt: new Date('2026-10-05T15:30:00.000Z'), ...over,
});

const PERIOD: Period = { startDate: '2026-10-01', endDate: '2026-10-31', range: { gte: utc0('2026-10-01'), lt: utc0('2026-11-01') } };

beforeEach(() => {
    jest.clearAllMocks();
    freezeNow(NOW);
    mock(prisma.$transaction).mockImplementation(async (callback: (client: Prisma.TransactionClient) => unknown) => callback(tx));
    settingIs({ isActive: true, pointsPerThanks: 2 });
    sentTodayIs([]);
    recipientIs({ id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: true });
    mock(prisma.evaluationPointThanks.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-t', createdAt: new Date(NOW), ...data,
    }));
    mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(thanksRow());
    mock(prisma.evaluationPointThanks.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.evaluationPointThanksSetting.upsert).mockResolvedValue({ id: 'default' });
    mock(prisma.evaluationPointLog.create).mockResolvedValue({});
    mock(prisma.user.findMany).mockResolvedValue([]);
});

afterEach(() => {
    jest.useRealTimers();
});

// ================================================================ getThanksSetting

describe('getThanksSetting', () => {
    it('行が無ければ「使わない・1回 1点」', async () => {
        settingIs(null);
        await expect(getThanksSetting()).resolves.toEqual({ isActive: false, pointsPerThanks: 1 });
    });
    it('行があれば、その値', async () => {
        settingIs({ isActive: true, pointsPerThanks: 5 });
        await expect(getThanksSetting()).resolves.toEqual({ isActive: true, pointsPerThanks: 5 });
        expect(mock(prisma.evaluationPointThanksSetting.findUnique).mock.calls[0][0].where).toEqual({ id: 'default' });
    });
});

// ================================================================ sendThanks

describe('sendThanks', () => {
    const send = (actor: PointActor = FOREMAN_A, toUserId = 'worker1', message: string | null = '助かりました') =>
        sendThanks({ actor, toUserId, message });

    it('鍵 → 読む（設定・相手・今日送った分）→ 作る → ログ の順で、全部トランザクションの中', async () => {
        const result = await send();
        expect(result.ok).toBe(true);
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.$executeRaw',
            'tx.evaluationPointThanksSetting.findUnique',
            'tx.user.findUnique',
            'tx.evaluationPointThanks.findMany',
            'tx.evaluationPointThanks.create',
            'tx.evaluationPointLog.create',
        ]);
        expect(mock(prisma.$transaction).mock.calls[0][1]).toEqual({ maxWait: 5000, timeout: 10000 });
        expect(THANKS_TX_OPTIONS).toEqual({ maxWait: 5000, timeout: 10000 });
    });

    it('鍵は pg_advisory_xact_lock で、送る人ごと（dandolink-thanks:送る人の id）', async () => {
        await send();
        expect(executedSqls()).toEqual(['SELECT pg_advisory_xact_lock(hashtext(dandolink-thanks:foremanA))']);
        // 送る人の id は、SQL の文字に埋め込まず、値として渡している
        const [strings, ...values] = mock(prisma.$executeRaw).mock.calls[0] as [string[], ...unknown[]];
        expect(values).toEqual(['dandolink-thanks:foremanA']);
        expect(strings.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))');
    });

    it('作る行: 送る人＝actor・日付＝今日（日本時間）の UTC 0時の印・点数＝設定の写し', async () => {
        const result = await send();
        const data = mock(prisma.evaluationPointThanks.create).mock.calls[0][0].data;
        expect(data).toEqual({ fromUserId: 'foremanA', toUserId: 'worker1', date: utc0(TODAY), message: '助かりました', points: 2 });
        expect(result).toEqual({
            ok: true,
            thanks: { id: 'new-t', date: TODAY, toUserId: 'worker1', toUserName: '作業員1', message: '助かりました' },
            remainingToday: 2,
        });
    });

    it('今日送った分を読む条件は「送る人・今日」', async () => {
        await send();
        expect(mock(prisma.evaluationPointThanks.findMany).mock.calls[0][0].where).toEqual({ fromUserId: 'foremanA', date: utc0(TODAY) });
        expect(mock(prisma.user.findUnique).mock.calls[0][0].where).toEqual({ id: 'worker1' });
    });

    it('点数は、そのときの設定の値（5点なら 5）', async () => {
        settingIs({ isActive: true, pointsPerThanks: 5 });
        await send();
        expect(mock(prisma.evaluationPointThanks.create).mock.calls[0][0].data.points).toBe(5);
    });

    it('ログ: thanks_sent・相手・作った行の id・日付・点数', async () => {
        await send();
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'thanks_sent',
            actorId: 'foremanA',
            actorName: '職長A',
            targetUserId: 'worker1',
            recordId: 'new-t',
            recordDate: utc0(TODAY),
            detail: { points: 2 },
        });
    });

    it('今日2回送っていれば、送れて、残りは 0', async () => {
        sentTodayIs(['a', 'b']);
        const result = await send();
        expect(result.ok && result.remainingToday).toBe(0);
    });

    describe('断るときは、何も書かない', () => {
        const cases: [string, () => void, PointActor, string, number, string][] = [
            ['対象外のロール', () => undefined, { id: 'p1', role: 'partner', name: '協力' }, 'worker1', 403, '権限がありません'],
            ['使わない', () => settingIs({ isActive: false, pointsPerThanks: 2 }), FOREMAN_A, 'worker1', 400,
                '「ありがとう」は、今は使えません（管理者が、設定の「評価ポイント」で「使う」にすると、送れます）'],
            ['設定の行が無い（＝使わない）', () => settingIs(null), FOREMAN_A, 'worker1', 400,
                '「ありがとう」は、今は使えません（管理者が、設定の「評価ポイント」で「使う」にすると、送れます）'],
            ['相手が無い', () => recipientIs(null), FOREMAN_A, 'nobody', 400, '相手が見つかりません'],
            ['相手が退職', () => recipientIs({ id: 'worker1', displayName: '作業員1', role: 'worker', isActive: false }), FOREMAN_A, 'worker1', 400, '相手が見つかりません'],
            ['自分', () => recipientIs({ id: 'foremanA', displayName: '職長A', role: 'foreman1', isActive: true }), FOREMAN_A, 'foremanA', 400, '自分には送れません'],
            ['相手が協力会社', () => recipientIs({ id: 'p1', displayName: '協力', role: 'PARTNER', isActive: true }), FOREMAN_A, 'p1', 400, '「ありがとう」を送れない相手です'],
            ['今日もう送った相手', () => sentTodayIs(['worker1']), FOREMAN_A, 'worker1', 400, '今日は、もうこの人に送っています（同じ人には1日1回までです）'],
            ['今日もう3回', () => sentTodayIs(['a', 'b', 'c']), FOREMAN_A, 'worker1', 400, '1日に送れるのは3回までです'],
        ];
        it.each(cases)('%s', async (_label, arrange, actor, toUserId, status, message) => {
            arrange();
            await expect(send(actor, toUserId)).resolves.toEqual({ ok: false, status, message });
            noWrites();
        });
    });

    it('一意の制約に当たったとき（P2002）は「今日は、もうこの人に送っています」の 400', async () => {
        mock(prisma.evaluationPointThanks.create).mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
        );
        await expect(send()).resolves.toEqual({
            ok: false, status: 400, message: '今日は、もうこの人に送っています（同じ人には1日1回までです）',
        });
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });

    it('ほかのエラーは、そのまま投げる', async () => {
        mock(prisma.evaluationPointThanks.create).mockRejectedValueOnce(new Error('boom'));
        await expect(send()).rejects.toThrow('boom');
        mock(prisma.evaluationPointThanks.create).mockRejectedValueOnce(
            new Prisma.PrismaClientKnownRequestError('FK', { code: 'P2003', clientVersion: '5.22.0' }),
        );
        await expect(send()).rejects.toThrow('FK');
    });
});

// ================================================================ removeThanks

describe('removeThanks', () => {
    it('本人の当日の分: 読む → 消す → ログ（消した行の全部の列）', async () => {
        await expect(removeThanks({ actor: FOREMAN_A, id: 't1' })).resolves.toEqual({ ok: true });
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.evaluationPointThanks.findUnique',
            'tx.evaluationPointThanks.deleteMany',
            'tx.evaluationPointLog.create',
        ]);
        expect(mock(prisma.evaluationPointThanks.deleteMany).mock.calls[0][0]).toEqual({ where: { id: 't1' } });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'thanks_removed',
            actorId: 'foremanA',
            actorName: '職長A',
            targetUserId: 'worker1',
            recordId: 't1',
            recordDate: utc0(TODAY),
            detail: {
                id: 't1', fromUserId: 'foremanA', toUserId: 'worker1', date: TODAY, message: 'ありがとう', points: 2,
                createdAt: '2026-10-05T15:30:00.000Z',
            },
        });
    });

    it('無ければ not_found で、何も書かない', async () => {
        mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(null);
        await expect(removeThanks({ actor: ADMIN, id: 'x' })).resolves.toEqual({ ok: false, reason: 'not_found' });
        noWrites();
    });

    it('本人の前の日の分・ほかの職長・作業員は forbidden で、何も書かない', async () => {
        mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(thanksRow({ date: utc0('2026-10-05') }));
        await expect(removeThanks({ actor: FOREMAN_A, id: 't1' })).resolves.toEqual({ ok: false, reason: 'forbidden' });
        mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(thanksRow());
        await expect(removeThanks({ actor: FOREMAN_B, id: 't1' })).resolves.toEqual({ ok: false, reason: 'forbidden' });
        await expect(removeThanks({ actor: WORKER, id: 't1' })).resolves.toEqual({ ok: false, reason: 'forbidden' });
        noWrites();
    });

    it('管理者・マネージャーは、前の日の・ほかの人の分も取り消せる', async () => {
        mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(thanksRow({ date: utc0('2026-09-01') }));
        await expect(removeThanks({ actor: MANAGER, id: 't1' })).resolves.toEqual({ ok: true });
        await expect(removeThanks({ actor: ADMIN, id: 't1' })).resolves.toEqual({ ok: true });
        expect(prisma.evaluationPointLog.create).toHaveBeenCalledTimes(2);
    });

    it('読んだあとで、ほかの人が先に消していた（件数 0）ときは not_found で、ログを書かない', async () => {
        mock(prisma.evaluationPointThanks.deleteMany).mockResolvedValue({ count: 0 });
        await expect(removeThanks({ actor: FOREMAN_A, id: 't1' })).resolves.toEqual({ ok: false, reason: 'not_found' });
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });
});

// ================================================================ updateThanksSetting

describe('updateThanksSetting', () => {
    it('変わった項目だけをログに残す（使う にしただけ）', async () => {
        settingIs({ isActive: false, pointsPerThanks: 2 });
        await expect(updateThanksSetting({ actor: ADMIN, isActive: true })).resolves.toEqual({ isActive: true, pointsPerThanks: 2 });
        expect(dbCalls()).toEqual([
            'prisma.$transaction',
            'tx.evaluationPointThanksSetting.findUnique',
            'tx.evaluationPointThanksSetting.upsert',
            'tx.evaluationPointLog.create',
        ]);
        const upsert = mock(prisma.evaluationPointThanksSetting.upsert).mock.calls[0][0];
        expect(upsert.where).toEqual({ id: 'default' });
        expect(upsert.update).toEqual({ isActive: true, pointsPerThanks: 2, updatedBy: 'admin1' });
        expect(upsert.create).toEqual({ id: 'default', isActive: true, pointsPerThanks: 2, updatedBy: 'admin1' });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'thanks_setting_updated',
            actorId: 'admin1',
            actorName: '管理者1',
            detail: { before: { isActive: false }, after: { isActive: true } },
        });
    });

    it('両方変えれば、両方', async () => {
        settingIs({ isActive: true, pointsPerThanks: 2 });
        await updateThanksSetting({ actor: ADMIN, isActive: false, pointsPerThanks: 10 });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data.detail).toEqual({
            before: { isActive: true, pointsPerThanks: 2 }, after: { isActive: false, pointsPerThanks: 10 },
        });
    });

    it('何も変わらなければ、何も書かない', async () => {
        settingIs({ isActive: true, pointsPerThanks: 2 });
        await expect(updateThanksSetting({ actor: ADMIN, isActive: true, pointsPerThanks: 2 })).resolves.toEqual({ isActive: true, pointsPerThanks: 2 });
        noWrites();
    });

    it('行が無いときは作る（既定と同じ値なら、ログは書かない）', async () => {
        settingIs(null);
        await updateThanksSetting({ actor: ADMIN, pointsPerThanks: 1 });
        expect(prisma.evaluationPointThanksSetting.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });
});

// ================================================================ loadThanksSendContext

describe('loadThanksSendContext', () => {
    const users = [
        { id: 'w2', displayName: 'い作業員', role: 'worker', dispatchSortOrder: null },
        { id: 'foremanA', displayName: '職長A', role: 'FOREMAN1', dispatchSortOrder: 1 },
        { id: 'w1', displayName: 'あ作業員', role: 'WORKER', dispatchSortOrder: null },
        { id: 'p1', displayName: '協力', role: 'PARTNER', dispatchSortOrder: 0 },
        { id: 'm1', displayName: 'マネージャー', role: 'manager', dispatchSortOrder: 2 },
        { id: 's1', displayName: '応援', role: 'support', dispatchSortOrder: 3 },
    ];

    it('相手: 在籍・対象のロール・自分以外。並びは compareUsers。今日送った分と残り', async () => {
        mock(prisma.user.findMany).mockResolvedValue(users);
        sentTodayIs(['w1']);
        const ctx = await loadThanksSendContext('foremanA');
        expect(ctx).toEqual({
            active: true,
            remainingToday: 2,
            sentTodayToIds: ['w1'],
            recipients: [
                { userId: 'm1', displayName: 'マネージャー' },
                { userId: 'w1', displayName: 'あ作業員' },
                { userId: 'w2', displayName: 'い作業員' },
            ],
        });
        expect(mock(prisma.user.findMany).mock.calls[0][0].where).toEqual({ isActive: true });
        expect(mock(prisma.evaluationPointThanks.findMany).mock.calls[0][0].where).toEqual({ fromUserId: 'foremanA', date: utc0(TODAY) });
    });

    it('使わないときは、相手は空（人を読まない）', async () => {
        settingIs({ isActive: false, pointsPerThanks: 1 });
        const ctx = await loadThanksSendContext('foremanA');
        expect(ctx.active).toBe(false);
        expect(ctx.recipients).toEqual([]);
        expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('設定を渡せば、設定を読み直さない', async () => {
        await loadThanksSendContext('foremanA', { isActive: true, pointsPerThanks: 3 });
        expect(prisma.evaluationPointThanksSetting.findUnique).not.toHaveBeenCalled();
    });
});

// ================================================================ loadMyThanks

describe('loadMyThanks', () => {
    beforeEach(() => {
        mock(prisma.evaluationPointThanks.findMany).mockImplementation(async (args: { where: Record<string, unknown> }) => {
            if (args.where.toUserId) {
                return [
                    thanksRow({ id: 'r1', fromUserId: 'foremanA', toUserId: 'worker1', points: 2 }),
                    thanksRow({ id: 'r2', fromUserId: 'gone', toUserId: 'worker1', date: utc0('2026-10-02'), message: null, points: 1 }),
                ];
            }
            return [
                thanksRow({ id: 's1', fromUserId: 'worker1', toUserId: 'foremanA', date: utc0(TODAY) }),
                thanksRow({ id: 's2', fromUserId: 'worker1', toUserId: 'foremanA', date: utc0('2026-10-03') }),
            ];
        });
        mock(prisma.user.findMany).mockResolvedValue([{ id: 'foremanA', displayName: '職長A' }]);
    });

    it('本人の「もらった」「送った」だけを読む（期間・新しい順）', async () => {
        await loadMyThanks({ userId: 'worker1', role: 'worker', period: PERIOD, showPoints: true });
        const calls = mock(prisma.evaluationPointThanks.findMany).mock.calls.map((c) => c[0]);
        expect(calls.map((c) => c.where)).toEqual([
            { toUserId: 'worker1', date: PERIOD.range },
            { fromUserId: 'worker1', date: PERIOD.range },
        ]);
        for (const c of calls) expect(c.orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
    });

    it('showPoints が true: 点数を返す。名前が無い人は（不明）。取り消しは本人の当日の分だけ', async () => {
        const mine = await loadMyThanks({ userId: 'worker1', role: 'worker', period: PERIOD, showPoints: true });
        expect(mine).toEqual({
            receivedCount: 2,
            receivedPoints: 3,
            received: [
                { id: 'r1', date: TODAY, fromUserName: '職長A', message: 'ありがとう', points: 2 },
                { id: 'r2', date: '2026-10-02', fromUserName: '（不明）', message: null, points: 1 },
            ],
            sent: [
                { id: 's1', date: TODAY, toUserId: 'foremanA', toUserName: '職長A', message: 'ありがとう', canRemove: true },
                { id: 's2', date: '2026-10-03', toUserId: 'foremanA', toUserName: '職長A', message: 'ありがとう', canRemove: false },
            ],
        });
    });

    it('showPoints が false: points・receivedPoints は null（回数・相手・ひとことは返す）', async () => {
        const mine = await loadMyThanks({ userId: 'worker1', role: 'worker', period: PERIOD, showPoints: false });
        expect(mine.receivedCount).toBe(2);
        expect(mine.receivedPoints).toBeNull();
        expect(mine.received.map((r) => r.points)).toEqual([null, null]);
        expect(mine.received.map((r) => r.fromUserName)).toEqual(['職長A', '（不明）']);
        expect(JSON.stringify(mine)).not.toMatch(/"points":\d/);
    });

    it('管理者・マネージャーは、前の日に送った分も取り消せる', async () => {
        const mine = await loadMyThanks({ userId: 'worker1', role: 'manager', period: PERIOD, showPoints: true });
        expect(mine.sent.map((s) => s.canRemove)).toEqual([true, true]);
    });
});

// ================================================================ loadThanksList

describe('loadThanksList', () => {
    it('期間の全員分。新しい順。名前を付ける', async () => {
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([
            thanksRow({ id: 'a', fromUserId: 'foremanA', toUserId: 'worker1' }),
            thanksRow({ id: 'b', fromUserId: 'gone', toUserId: 'foremanA', message: null, points: 0 }),
        ]);
        mock(prisma.user.findMany).mockResolvedValue([{ id: 'foremanA', displayName: '職長A' }, { id: 'worker1', displayName: '作業員1' }]);
        const list = await loadThanksList(PERIOD);
        const args = mock(prisma.evaluationPointThanks.findMany).mock.calls[0][0];
        expect(args.where).toEqual({ date: PERIOD.range });
        expect(args.orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
        expect(list).toEqual([
            { id: 'a', date: TODAY, fromUserId: 'foremanA', fromUserName: '職長A', toUserId: 'worker1', toUserName: '作業員1', message: 'ありがとう', points: 2, createdAt: '2026-10-05T15:30:00.000Z' },
            { id: 'b', date: TODAY, fromUserId: 'gone', fromUserName: '（不明）', toUserId: 'foremanA', toUserName: '職長A', message: null, points: 0, createdAt: '2026-10-05T15:30:00.000Z' },
        ]);
    });
});

