/**
 * @jest-environment node
 *
 * 評価ポイントの点数の履歴 API のテスト（docs/指示書_評価ポイント.md の 6-1・8-1）。
 *   GET・POST /api/evaluation-points/items/[id]/rates
 *   DELETE /api/evaluation-points/items/[id]/rates/[rateId]
 *
 * 日付: 「今日」が要るテストは、時計（Date だけ）を固定する（freezeNow）。
 */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/evaluation-points/items/[id]/rates/route';
import { DELETE } from '@/app/api/evaluation-points/items/[id]/rates/[rateId]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

/** username（ログイン名）は、わざと id と違う値にする */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER = { id: 'manager1', role: 'manager', name: 'マネージャー1' };

const freezeNow = (iso: string) =>
    jest.useFakeTimers({
        now: new Date(iso),
        doNotFake: [
            'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
            'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
            'setTimeout', 'clearTimeout',
        ],
    });

const jsonRequest = (path: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

interface Body { error?: string; details?: string; ok?: boolean; rate?: Record<string, unknown> }
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Body });

const getRates = (id = 'wash') => GET(jsonRequest(`/api/evaluation-points/items/${id}/rates`, 'GET'), { params: { id } }).then(read);
const postRate = (body: unknown, id = 'wash') => POST(jsonRequest(`/api/evaluation-points/items/${id}/rates`, 'POST', body), { params: { id } }).then(read);
const delRate = (rateId: string, id = 'wash') =>
    DELETE(jsonRequest(`/api/evaluation-points/items/${id}/rates/${rateId}`, 'DELETE'), { params: { id, rateId } }).then(read);

const rateRow = (over: Record<string, unknown> = {}) => ({
    id: 'rate-x', itemId: 'wash', points: 3, effectiveFrom: utc0('2026-10-10'),
    createdBy: 'admin1', createdByName: '管理者1', createdAt: new Date('2026-10-02T01:00:00.000Z'),
    ...over,
});

const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.evaluationPointRate.create).not.toHaveBeenCalled();
    expect(prisma.evaluationPointRate.deleteMany).not.toHaveBeenCalled();
    expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
};

beforeEach(() => {
    jest.clearAllMocks();
    // 日本時間 2026-10-03 12:00
    freezeNow('2026-10-03T03:00:00.000Z');
    loginAs(ADMIN);
    mock(prisma.evaluationPointItem.findUnique).mockResolvedValue({ id: 'wash' });
    mock(prisma.evaluationPointRate.findMany).mockResolvedValue([]);
    mock(prisma.evaluationPointRate.findUnique).mockResolvedValue(null);
    mock(prisma.evaluationPointRate.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-rate', createdAt: new Date('2026-10-03T03:00:00.000Z'), ...data,
    }));
    mock(prisma.evaluationPointRate.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.evaluationPointLog.create).mockResolvedValue({});
});

afterEach(() => {
    jest.useRealTimers();
});

describe('GET /api/evaluation-points/items/[id]/rates', () => {
    it('職長は 403', async () => {
        loginAs({ id: 'foreman1', role: 'foreman1' });
        expect((await getRates()).status).toBe(403);
    });

    it('項目が無ければ 404', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(null);
        const r = await getRates('missing');
        expect([r.status, r.body.error]).toEqual([404, '項目が見つかりません']);
    });

    it('マネージャーは見られる。新しい順で、予約・今の点数・以前 の状態が付く', async () => {
        loginAs(MANAGER);
        mock(prisma.evaluationPointRate.findMany).mockResolvedValue([
            rateRow({ id: 'r4', points: 5, effectiveFrom: utc0('2026-11-01') }),
            rateRow({ id: 'r3', points: 4, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-10-01T02:00:00.000Z') }),
            rateRow({ id: 'r2', points: 3, effectiveFrom: utc0('2026-10-01'), createdAt: new Date('2026-10-01T01:00:00.000Z') }),
            rateRow({ id: 'r1', points: 2, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T01:00:00.000Z'), createdByName: '管理者2' }),
        ]);
        const r = await getRates();
        expect(r.status).toBe(200);
        expect(mock(prisma.evaluationPointRate.findMany).mock.calls[0][0]).toMatchObject({
            where: { itemId: 'wash' },
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        });
        // 応答は、点数の行の配列そのもの
        expect(r.body).toEqual([
            { id: 'r4', points: 5, effectiveFrom: '2026-11-01', createdByName: '管理者1', createdAt: '2026-10-02T01:00:00.000Z', state: 'upcoming' },
            { id: 'r3', points: 4, effectiveFrom: '2026-10-01', createdByName: '管理者1', createdAt: '2026-10-01T02:00:00.000Z', state: 'current' },
            { id: 'r2', points: 3, effectiveFrom: '2026-10-01', createdByName: '管理者1', createdAt: '2026-10-01T01:00:00.000Z', state: 'past' },
            { id: 'r1', points: 2, effectiveFrom: '2026-09-01', createdByName: '管理者2', createdAt: '2026-09-01T01:00:00.000Z', state: 'past' },
        ]);
    });
});

describe('POST /api/evaluation-points/items/[id]/rates', () => {
    it('admin 以外は 403（マネージャーも）', async () => {
        loginAs(MANAGER);
        const r = await postRate({ points: 3, effectiveFrom: '2026-10-10' });
        expect([r.status, r.body.error]).toEqual([403, '権限がありません']);
        noWrites();
    });

    it('形が違う → 400「入力が不正です」／日付の形が違う → 400「日付が不正です」', async () => {
        for (const body of [{ points: '3', effectiveFrom: '2026-10-10' }, { points: -1, effectiveFrom: '2026-10-10' }, { points: 3 }]) {
            expect([JSON.stringify(body), (await postRate(body)).body.details]).toEqual([JSON.stringify(body), '入力が不正です']);
        }
        for (const effectiveFrom of ['2026-02-30', '2026/10/10', '']) {
            expect([effectiveFrom, (await postRate({ points: 3, effectiveFrom })).body.details]).toEqual([effectiveFrom, '日付が不正です']);
        }
        noWrites();
    });

    it('適用開始日が今日（日本時間）より前なら 400。何も書かない', async () => {
        const r = await postRate({ points: 3, effectiveFrom: '2026-10-02' });
        expect([r.status, r.body.error]).toEqual([400, '適用開始日は、今日以降にしてください']);
        noWrites();
    });

    it('「今日」は日本時間で決まる（UTC ではまだ前日でも、日本の日付が今日なら、前日は過去）', async () => {
        freezeNow('2026-10-02T15:30:00.000Z'); // 日本時間 10/3 0:30
        expect((await postRate({ points: 3, effectiveFrom: '2026-10-02' })).body.error).toBe('適用開始日は、今日以降にしてください');
        expect((await postRate({ points: 3, effectiveFrom: '2026-10-03' })).status).toBe(201);
    });

    it('項目が無ければ 404', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(null);
        const r = await postRate({ points: 3, effectiveFrom: '2026-10-10' }, 'missing');
        expect([r.status, r.body.error]).toEqual([404, '項目が見つかりません']);
        noWrites();
    });

    it('今日以降なら行を足して、rate_added のログを書く（予約は upcoming、今日は current）', async () => {
        const r = await postRate({ points: 7, effectiveFrom: '2026-10-10' });
        expect(r.status).toBe(201);
        expect(mock(prisma.evaluationPointRate.create).mock.calls[0][0].data).toEqual({
            itemId: 'wash', points: 7, effectiveFrom: utc0('2026-10-10'), createdBy: 'admin1', createdByName: '管理者1',
        });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'rate_added', actorId: 'admin1', actorName: '管理者1', itemId: 'wash',
            detail: { points: 7, effectiveFrom: '2026-10-10' },
        });
        expect(r.body.rate).toEqual({
            id: 'new-rate', points: 7, effectiveFrom: '2026-10-10', createdByName: '管理者1', createdAt: '2026-10-03T03:00:00.000Z', state: 'upcoming',
        });

        expect((await postRate({ points: 7, effectiveFrom: '2026-10-03' })).body.rate?.state).toBe('current');
    });
});

describe('DELETE /api/evaluation-points/items/[id]/rates/[rateId]', () => {
    it('admin 以外は 403（マネージャーも）', async () => {
        loginAs(MANAGER);
        expect((await delRate('rate-x')).status).toBe(403);
        noWrites();
    });

    it('行が無い・ほかの項目の行なら 404', async () => {
        expect((await delRate('missing')).status).toBe(404);
        mock(prisma.evaluationPointRate.findUnique).mockResolvedValue(rateRow({ itemId: 'other' }));
        expect((await delRate('rate-x')).status).toBe(404);
        noWrites();
    });

    it('予約でない行（適用開始日が今日以前）は 400。何も消さない', async () => {
        for (const day of ['2026-10-03', '2026-09-01']) {
            mock(prisma.evaluationPointRate.findUnique).mockResolvedValue(rateRow({ effectiveFrom: utc0(day) }));
            const r = await delRate('rate-x');
            expect([day, r.status, r.body.error]).toEqual([day, 400, 'すでに始まっている点数は取り消せません']);
        }
        noWrites();
    });

    it('予約なら、条件つきで消して、取り消した行の全部の列をログに残す', async () => {
        mock(prisma.evaluationPointRate.findUnique).mockResolvedValue(rateRow());
        const r = await delRate('rate-x');
        expect([r.status, r.body]).toEqual([200, { ok: true }]);
        expect(prisma.evaluationPointRate.deleteMany).toHaveBeenCalledWith({ where: { id: 'rate-x', effectiveFrom: { gt: utc0('2026-10-03') } } });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'rate_cancelled', actorId: 'admin1', actorName: '管理者1', itemId: 'wash',
            detail: {
                id: 'rate-x', itemId: 'wash', points: 3, effectiveFrom: '2026-10-10',
                createdBy: 'admin1', createdByName: '管理者1', createdAt: '2026-10-02T01:00:00.000Z',
            },
        });
    });

    it('確かめたあとに始まって消えなかったら 400。ログは書かない', async () => {
        mock(prisma.evaluationPointRate.findUnique).mockResolvedValue(rateRow());
        mock(prisma.evaluationPointRate.deleteMany).mockResolvedValue({ count: 0 });
        const r = await delRate('rate-x');
        expect([r.status, r.body.error]).toEqual([400, 'すでに始まっている点数は取り消せません']);
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });
});
