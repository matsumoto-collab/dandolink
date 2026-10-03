/**
 * @jest-environment node
 *
 * 評価ポイントの点数表 API のテスト（docs/指示書_評価ポイント.md の 6-1・8-1）。
 *   GET・POST /api/evaluation-points/items
 *   PATCH・DELETE /api/evaluation-points/items/[id]
 *   PUT /api/evaluation-points/items/order
 *
 * @/lib/prisma と @/lib/api/utils は、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * だから「絞り込みが正しいか」は、返ってきた値ではなく、findFirst・create などに渡した引数で確かめる。
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { GET, POST } from '@/app/api/evaluation-points/items/route';
import { PATCH, DELETE } from '@/app/api/evaluation-points/items/[id]/route';
import { PUT as PUT_ORDER } from '@/app/api/evaluation-points/items/order/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };
const MANAGER = { id: 'manager1', role: 'manager', name: 'マネージャー1' };
const FOREMAN = { id: 'foreman1', role: 'foreman1', name: '職長1' };

/** 「今」を固定する（Date だけを差し替える）。戻すのは jest.useRealTimers() */
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
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
const params = (id: string) => ({ params: { id } });

interface Body { error?: string; details?: string; item?: Record<string, unknown>; ok?: boolean }
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Body, res });

const post = (body: unknown) => POST(jsonRequest('/api/evaluation-points/items', 'POST', body)).then(read);
const patch = (id: string, body: unknown) => PATCH(jsonRequest(`/api/evaluation-points/items/${id}`, 'PATCH', body), params(id)).then(read);
const del = (id: string) => DELETE(jsonRequest(`/api/evaluation-points/items/${id}`, 'DELETE'), params(id)).then(read);
const putOrder = (body: unknown) => PUT_ORDER(jsonRequest('/api/evaluation-points/items/order', 'PUT', body)).then(read);

const itemRow = (over: Record<string, unknown> = {}) => ({
    id: 'wash', name: '洗車', description: null, inputBy: 'foreman', isActive: true, sortOrder: 0,
    createdBy: 'admin1', createdAt: new Date('2026-09-01T00:00:00.000Z'), updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    _count: { records: 0 },
    ...over,
});

/** 何も書いていないこと */
const noWrites = () => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.evaluationPointItem.create).not.toHaveBeenCalled();
    expect(prisma.evaluationPointItem.update).not.toHaveBeenCalled();
    expect(prisma.evaluationPointItem.delete).not.toHaveBeenCalled();
    expect(prisma.evaluationPointRate.create).not.toHaveBeenCalled();
    expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
};

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(ADMIN);
    mock(prisma.evaluationPointItem.findMany).mockResolvedValue([]);
    mock(prisma.evaluationPointItem.findFirst).mockResolvedValue(null);
    mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(null);
    mock(prisma.evaluationPointItem.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-item', ...data }));
    mock(prisma.evaluationPointItem.update).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => itemRow(data));
    mock(prisma.evaluationPointItem.delete).mockResolvedValue({});
    mock(prisma.evaluationPointRate.findMany).mockResolvedValue([]);
    mock(prisma.evaluationPointRate.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-rate', createdAt: new Date('2026-10-03T01:00:00.000Z'), ...data,
    }));
    mock(prisma.evaluationPointRecord.count).mockResolvedValue(0);
    mock(prisma.evaluationPointLog.create).mockResolvedValue({});
});

afterEach(() => {
    jest.useRealTimers();
});

describe('GET /api/evaluation-points/items', () => {
    it('職長・作業員は 403（職長向けの項目は GET /day が返す）', async () => {
        for (const user of [FOREMAN, { id: 'worker1', role: 'worker' }]) {
            loginAs(user);
            const r = await GET().then(read);
            expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointItem.findMany).not.toHaveBeenCalled();
    });

    it('マネージャーは見られる。今の点数・予約・記録の件数が付く（予約は日付の古い順）', async () => {
        freezeNow('2026-10-03T03:00:00.000Z'); // 日本時間 10/3 12:00
        loginAs(MANAGER);
        mock(prisma.evaluationPointItem.findMany).mockResolvedValue([
            itemRow({ _count: { records: 4 } }),
            itemRow({ id: 'none', name: '点数なし', sortOrder: 1 }),
        ]);
        mock(prisma.evaluationPointRate.findMany).mockResolvedValue([
            { id: 'r1', itemId: 'wash', points: 2, effectiveFrom: utc0('2026-09-01'), createdAt: new Date('2026-09-01T00:00:00.000Z') },
            { id: 'r3', itemId: 'wash', points: 5, effectiveFrom: utc0('2026-11-01'), createdAt: new Date('2026-10-02T00:00:00.000Z') },
            { id: 'r2', itemId: 'wash', points: 4, effectiveFrom: utc0('2026-10-04'), createdAt: new Date('2026-10-02T01:00:00.000Z') },
        ]);
        const r = await GET().then(read);
        expect(r.status).toBe(200);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        // 応答は、項目の配列そのもの
        expect(r.body).toEqual([
            {
                id: 'wash', name: '洗車', description: null, inputBy: 'foreman', isActive: true, sortOrder: 0,
                currentPoints: 2,
                upcomingRates: [{ id: 'r2', points: 4, effectiveFrom: '2026-10-04' }, { id: 'r3', points: 5, effectiveFrom: '2026-11-01' }],
                recordCount: 4,
            },
            {
                id: 'none', name: '点数なし', description: null, inputBy: 'foreman', isActive: true, sortOrder: 1,
                currentPoints: null, upcomingRates: [], recordCount: 0,
            },
        ]);
        expect(mock(prisma.evaluationPointItem.findMany).mock.calls[0][0].orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
    });
});

describe('POST /api/evaluation-points/items', () => {
    const valid = { name: '洗車', description: '車をきれいにした', inputBy: 'foreman', points: 2 };

    it('admin 以外は 403（マネージャーも）。何も読まない・書かない', async () => {
        for (const user of [MANAGER, FOREMAN, { id: 'worker1', role: 'worker' }]) {
            loginAs(user);
            const r = await post(valid);
            expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointItem.findFirst).not.toHaveBeenCalled();
        noWrites();
    });

    it('DB のロールが大文字（ADMIN）でも admin として扱う', async () => {
        loginAs({ ...ADMIN, role: 'ADMIN' });
        expect((await post(valid)).status).toBe(201);
    });

    it('入力の形が違う → 400「入力が不正です」（validationErrorResponse）', async () => {
        const cases: unknown[] = [
            { ...valid, name: '' }, { ...valid, name: '   ' }, { ...valid, name: 'あ'.repeat(31) }, { ...valid, name: 1 },
            { ...valid, description: 'あ'.repeat(201) }, { ...valid, description: 3 },
            { ...valid, inputBy: 'worker' }, { ...valid, inputBy: undefined },
            { ...valid, points: '2' }, { ...valid, points: -1 }, { ...valid, points: 1.5 }, { ...valid, points: 10000 }, { ...valid, points: undefined },
            'JSON ではない', [], null,
        ];
        for (const body of cases) {
            const r = await post(body);
            expect([JSON.stringify(body), r.status, r.body.error, r.body.details]).toEqual([JSON.stringify(body), 400, 'Validation Error', '入力が不正です']);
        }
        noWrites();
    });

    it('同じ名前の項目（前後の空白を取って比べる・使っていない項目も含む）があれば 400', async () => {
        mock(prisma.evaluationPointItem.findFirst).mockResolvedValueOnce({ id: 'old' });
        const r = await post({ ...valid, name: '  洗車  ' });
        expect([r.status, r.body.error]).toEqual([400, '同じ名前の項目が、すでにあります']);
        // isActive で絞らずに、名前だけで探している
        expect(prisma.evaluationPointItem.findFirst).toHaveBeenCalledWith({ where: { name: '洗車' }, select: { id: true } });
        noWrites();
    });

    it('作ると、項目と最初の点数の行（適用開始日 = 日本時間の今日）が同じトランザクションででき、ログは item_created だけ', async () => {
        freezeNow('2026-10-02T15:30:00.000Z'); // 日本時間 10/3 0:30（UTC ではまだ 10/2）
        // 1回目 = 同じ名前の確認（無し）／2回目 = 今の最大の sortOrder
        mock(prisma.evaluationPointItem.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ sortOrder: 4 });

        const r = await post({ ...valid, description: '  ' });
        expect(r.status).toBe(201);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);

        expect(mock(prisma.evaluationPointItem.create).mock.calls[0][0].data).toEqual({
            name: '洗車', description: null, inputBy: 'foreman', sortOrder: 5, isActive: true, createdBy: 'admin1',
        });
        expect(mock(prisma.evaluationPointRate.create).mock.calls[0][0].data).toEqual({
            itemId: 'new-item', points: 2, effectiveFrom: utc0('2026-10-03'), createdBy: 'admin1', createdByName: '管理者1',
        });
        expect(prisma.evaluationPointLog.create).toHaveBeenCalledTimes(1);
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'item_created', actorId: 'admin1', actorName: '管理者1', itemId: 'new-item',
            detail: { name: '洗車', description: null, inputBy: 'foreman', points: 2 },
        });
        expect(r.body.item).toEqual({
            id: 'new-item', name: '洗車', description: null, inputBy: 'foreman', isActive: true, sortOrder: 5,
            currentPoints: 2, upcomingRates: [], recordCount: 0,
        });
    });

    it('項目が1つも無ければ sortOrder は 0。名前が無い session では username を名前に写す', async () => {
        loginAs({ id: 'admin1', role: 'admin' });
        const r = await post(valid);
        expect(r.status).toBe(201);
        expect(mock(prisma.evaluationPointItem.create).mock.calls[0][0].data.sortOrder).toBe(0);
        expect(mock(prisma.evaluationPointRate.create).mock.calls[0][0].data.createdByName).toBe('login-admin1');
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data.actorName).toBe('login-admin1');
    });
});

describe('PATCH /api/evaluation-points/items/[id]', () => {
    it('admin 以外は 403（マネージャーも）', async () => {
        loginAs(MANAGER);
        const r = await patch('wash', { isActive: false });
        expect([r.status, r.body.error]).toEqual([403, '権限がありません']);
        noWrites();
    });

    it('項目が無ければ 404', async () => {
        const r = await patch('missing', { isActive: false });
        expect([r.status, r.body.error]).toEqual([404, '項目が見つかりません']);
        noWrites();
    });

    it('形が違う・何も指定が無い → 400「入力が不正です」', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(itemRow());
        for (const body of [{}, { isActive: 'false' }, { name: '' }, { inputBy: 'x' }, { description: 5 }]) {
            const r = await patch('wash', body);
            expect([JSON.stringify(body), r.status, r.body.details]).toEqual([JSON.stringify(body), 400, '入力が不正です']);
        }
        noWrites();
    });

    it('同じ名前の項目があれば 400（自分自身は除いて探す）', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(itemRow());
        mock(prisma.evaluationPointItem.findFirst).mockResolvedValue({ id: 'other' });
        const r = await patch('wash', { name: '手伝い' });
        expect([r.status, r.body.error]).toEqual([400, '同じ名前の項目が、すでにあります']);
        expect(prisma.evaluationPointItem.findFirst).toHaveBeenCalledWith({ where: { name: '手伝い', id: { not: 'wash' } }, select: { id: true } });
        noWrites();
    });

    it('変わった列だけを直し、ログの before・after も変わった列だけ', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(itemRow());
        const r = await patch('wash', { name: '洗車', isActive: false, description: ' 説明 ' });
        expect(r.status).toBe(200);
        expect(mock(prisma.evaluationPointItem.update).mock.calls[0][0].data).toEqual({ isActive: false, description: '説明' });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'item_updated', actorId: 'admin1', actorName: '管理者1', itemId: 'wash',
            detail: { before: { isActive: true, description: null }, after: { isActive: false, description: '説明' } },
        });
        expect(r.body.item).toMatchObject({ id: 'wash', isActive: false, description: '説明' });
    });

    it('何も変わらなければ、書き込みもログもしない（200）', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(itemRow());
        const r = await patch('wash', { name: '洗車', isActive: true });
        expect(r.status).toBe(200);
        noWrites();
    });
});

describe('DELETE /api/evaluation-points/items/[id]', () => {
    it('admin 以外は 403（マネージャーも）', async () => {
        loginAs(MANAGER);
        expect((await del('wash')).status).toBe(403);
        noWrites();
    });

    it('記録のある項目は 400。記録はこの項目の ID で数える', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(itemRow());
        mock(prisma.evaluationPointRecord.count).mockResolvedValue(1);
        const r = await del('wash');
        expect([r.status, r.body.error]).toEqual([400, '記録があるので削除できません。『使わない』にしてください']);
        expect(prisma.evaluationPointRecord.count).toHaveBeenCalledWith({ where: { itemId: 'wash' } });
        noWrites();
    });

    it('確かめたあとに記録が付いて外部キーで断られたときも、同じ 400（500 にしない）', async () => {
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(itemRow());
        mock(prisma.evaluationPointItem.delete).mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '5.22.0' }),
        );
        const r = await del('wash');
        expect([r.status, r.body.error]).toEqual([400, '記録があるので削除できません。『使わない』にしてください']);
    });

    it('記録が無ければ消して、削除した項目の全部の列をログに残す', async () => {
        const { _count, ...row } = itemRow();
        void _count;
        mock(prisma.evaluationPointItem.findUnique).mockResolvedValue(row);
        const r = await del('wash');
        expect([r.status, r.body]).toEqual([200, { ok: true }]);
        expect(prisma.evaluationPointItem.delete).toHaveBeenCalledWith({ where: { id: 'wash' } });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'item_deleted', actorId: 'admin1', actorName: '管理者1', itemId: 'wash',
            detail: {
                id: 'wash', name: '洗車', description: null, inputBy: 'foreman', sortOrder: 0, isActive: true,
                createdBy: 'admin1', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
            },
        });
    });
});

describe('PUT /api/evaluation-points/items/order', () => {
    beforeEach(() => {
        mock(prisma.evaluationPointItem.findMany).mockResolvedValue([
            { id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 1 }, { id: 'c', sortOrder: 2 },
        ]);
    });

    it('admin 以外は 403（マネージャーも）', async () => {
        loginAs(MANAGER);
        expect((await putOrder({ ids: ['b', 'a', 'c'] })).status).toBe(403);
        noWrites();
    });

    it('ids が文字列の配列でなければ 400「入力が不正です」', async () => {
        for (const body of [{}, { ids: 'a' }, { ids: ['a', 1] }]) {
            expect((await putOrder(body)).body.details).toBe('入力が不正です');
        }
        noWrites();
    });

    it('過不足・重複があれば 400', async () => {
        for (const ids of [['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'a', 'b'], ['a', 'b', 'x']]) {
            const r = await putOrder({ ids });
            expect([ids.join(','), r.status, r.body.error]).toEqual([ids.join(','), 400, '項目が変わっています。画面を読み直してください']);
        }
        noWrites();
    });

    it('sortOrder を 0 から振り直す（変わる項目だけ）。ログは1回の操作で1行', async () => {
        const r = await putOrder({ ids: ['b', 'a', 'c'] });
        expect([r.status, r.body]).toEqual([200, { ok: true }]);
        expect(mock(prisma.evaluationPointItem.update).mock.calls.map((c) => c[0])).toEqual([
            { where: { id: 'b' }, data: { sortOrder: 0 } },
            { where: { id: 'a' }, data: { sortOrder: 1 } },
        ]);
        expect(prisma.evaluationPointLog.create).toHaveBeenCalledTimes(1);
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toEqual({
            action: 'items_reordered', actorId: 'admin1', actorName: '管理者1', detail: { ids: ['b', 'a', 'c'] },
        });
    });
});

describe('ログインしていないとき', () => {
    it('どの操作も 401 のまま返す', async () => {
        // 応答の本文は1回しか読めないので、呼ばれるたびに新しい応答を返す
        mock(requireAuth).mockImplementation(async () => ({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }));
        expect((await GET()).status).toBe(401);
        expect((await post({})).status).toBe(401);
        expect((await patch('wash', {})).status).toBe(401);
        expect((await del('wash')).status).toBe(401);
        expect((await putOrder({ ids: [] })).status).toBe(401);
        noWrites();
    });
});
