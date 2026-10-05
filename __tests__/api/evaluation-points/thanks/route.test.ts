/**
 * @jest-environment node
 *
 * POST・GET /api/evaluation-points/thanks のテスト。
 *   POST: 対象のロールの人。送る人は必ずセッションの id。日付は今日（日本時間）
 *   GET : admin・manager だけ。期間の全員分
 */
import { GET, POST } from '@/app/api/evaluation-points/thanks/route';
import { prisma } from '@/lib/prisma';
import {
    ADMIN, FOREMAN, FOREMAN2, MANAGER, NOW, OUTSIDERS, TODAY, WORKER,
    freezeNow, jsonRequest, loginAs, logout, mock, noThanksWrites, read, utc0,
} from './_helpers';

const postThanks = (body: unknown) => POST(jsonRequest('/api/evaluation-points/thanks', 'POST', body)).then(read);
const getThanks = (query: string) => GET(jsonRequest(`/api/evaluation-points/thanks?${query}`, 'GET')).then(read);

const INACTIVE = '「ありがとう」は、今は使えません（管理者が、設定の「評価ポイント」で「使う」にすると、送れます）';

beforeEach(() => {
    jest.clearAllMocks();
    freezeNow(NOW);
    loginAs(FOREMAN);
    mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive: true, pointsPerThanks: 3 });
    mock(prisma.user.findUnique).mockResolvedValue({ id: 'worker1', displayName: '作業員1', role: 'WORKER', isActive: true });
    mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([]);
    mock(prisma.evaluationPointThanks.create).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-t', createdAt: new Date(NOW), ...data,
    }));
    mock(prisma.evaluationPointLog.create).mockResolvedValue({});
    mock(prisma.user.findMany).mockResolvedValue([]);
});

afterEach(() => {
    jest.useRealTimers();
});

// ================================================================ POST

describe('POST /api/evaluation-points/thanks', () => {
    it('ログインしていなければ 401', async () => {
        logout();
        expect((await postThanks({ toUserId: 'worker1' })).status).toBe(401);
        noThanksWrites();
    });

    it('対象外のロールは 403「権限がありません」で、何も読まず書かない', async () => {
        for (const user of OUTSIDERS) {
            loginAs(user);
            const r = await postThanks({ toUserId: 'worker1' });
            expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
        }
        expect(prisma.$transaction).not.toHaveBeenCalled();
        noThanksWrites();
    });

    it('送れる → 201・今日の日付・点数は設定の写し・残りの回数', async () => {
        const res = await POST(jsonRequest('/api/evaluation-points/thanks', 'POST', { toUserId: 'worker1', message: '  助かりました ' }));
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(await read(res)).toEqual({
            status: 201,
            body: {
                thanks: { id: 'new-t', date: TODAY, toUserId: 'worker1', toUserName: '作業員1', message: '助かりました' },
                remainingToday: 2,
            },
        });
        expect(mock(prisma.evaluationPointThanks.create).mock.calls[0][0].data).toEqual({
            fromUserId: 'foremanA', toUserId: 'worker1', date: utc0(TODAY), message: '助かりました', points: 3,
        });
    });

    it('どのロールでも送れる（admin・manager・foreman・worker）', async () => {
        for (const user of [ADMIN, MANAGER, FOREMAN2, WORKER]) {
            loginAs(user);
            mock(prisma.user.findUnique).mockResolvedValue({ id: 'other', displayName: 'ほか', role: 'worker', isActive: true });
            expect([user.role, (await postThanks({ toUserId: 'other' })).status]).toEqual([user.role, 201]);
        }
    });

    it('送った人は、ボディに何を入れてもセッションの id', async () => {
        const r = await postThanks({ toUserId: 'worker1', fromUserId: 'admin1', userId: 'admin1', actorId: 'admin1', date: '2020-01-01', points: 999 });
        expect(r.status).toBe(201);
        const data = mock(prisma.evaluationPointThanks.create).mock.calls[0][0].data;
        expect(data.fromUserId).toBe('foremanA');
        expect(data.date).toEqual(utc0(TODAY));
        expect(data.points).toBe(3);
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data.actorId).toBe('foremanA');
        expect(mock(prisma.evaluationPointThanks.findMany).mock.calls[0][0].where).toEqual({ fromUserId: 'foremanA', date: utc0(TODAY) });
    });

    it('ひとことは省略・null・空なら null', async () => {
        for (const body of [{ toUserId: 'worker1' }, { toUserId: 'worker1', message: null }, { toUserId: 'worker1', message: '  ' }]) {
            mock(prisma.evaluationPointThanks.create).mockClear();
            expect((await postThanks(body)).status).toBe(201);
            expect(mock(prisma.evaluationPointThanks.create).mock.calls[0][0].data.message).toBeNull();
        }
    });

    it('toUserId が文字列でない・空・body の形が違う → 400「入力が不正です」で、何も書かない', async () => {
        for (const body of [{}, { toUserId: '' }, { toUserId: 1 }, { toUserId: null }, [], null, 'x', '{bad json']) {
            const r = await postThanks(body);
            expect([body, r.status, r.body.details]).toEqual([body, 400, '入力が不正です']);
        }
        expect(prisma.$transaction).not.toHaveBeenCalled();
        noThanksWrites();
    });

    it('ひとことが 100字を超える・文字列でない → 400「ひとことは100字までの文字で入れてください」', async () => {
        for (const message of ['あ'.repeat(101), 1, true, ['a'], { a: 1 }]) {
            const r = await postThanks({ toUserId: 'worker1', message });
            expect([message, r.status, r.body.error]).toEqual([message, 400, 'ひとことは100字までの文字で入れてください']);
        }
        expect((await postThanks({ toUserId: 'worker1', message: 'あ'.repeat(100) })).status).toBe(201);
    });

    describe('決まりで断るとき（文言をそのまま返し、何も書かない）', () => {
        const cases: [string, () => void, string, number, string][] = [
            ['使わない', () => mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive: false, pointsPerThanks: 1 }), 'worker1', 400, INACTIVE],
            ['相手が無い', () => mock(prisma.user.findUnique).mockResolvedValue(null), 'nobody', 400, '相手が見つかりません'],
            ['自分', () => mock(prisma.user.findUnique).mockResolvedValue({ id: 'foremanA', displayName: '職長A', role: 'foreman1', isActive: true }), 'foremanA', 400, '自分には送れません'],
            ['協力会社', () => mock(prisma.user.findUnique).mockResolvedValue({ id: 'p1', displayName: '協力', role: 'PARTNER', isActive: true }), 'p1', 400, '「ありがとう」を送れない相手です'],
            ['今日もう送った', () => mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([{ toUserId: 'worker1' }]), 'worker1', 400, '今日は、もうこの人に送っています（同じ人には1日1回までです）'],
            ['今日もう3回', () => mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([{ toUserId: 'a' }, { toUserId: 'b' }, { toUserId: 'c' }]), 'worker1', 400, '1日に送れるのは3回までです'],
        ];
        it.each(cases)('%s', async (_label, arrange, toUserId, status, message) => {
            arrange();
            const r = await postThanks({ toUserId });
            expect([r.status, r.body.error]).toEqual([status, message]);
            noThanksWrites();
        });
    });
});

// ================================================================ GET

describe('GET /api/evaluation-points/thanks', () => {
    it('ログインしていなければ 401', async () => {
        logout();
        expect((await getThanks('startDate=2026-10-01&endDate=2026-10-31')).status).toBe(401);
    });

    it('admin・manager 以外は 403「権限がありません」で、何も読まない', async () => {
        for (const user of [FOREMAN, FOREMAN2, WORKER, ...OUTSIDERS]) {
            loginAs(user);
            const r = await getThanks('startDate=2026-10-01&endDate=2026-10-31');
            expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointThanks.findMany).not.toHaveBeenCalled();
    });

    it('期間が無い・片方・形が違えば 400', async () => {
        loginAs(ADMIN);
        expect((await getThanks('')).body.details).toBe('入力が不正です');
        expect((await getThanks('startDate=2026-10-01')).body.details).toBe('入力が不正です');
        expect((await getThanks('startDate=2026-10-31&endDate=2026-10-01')).body.details).toBe('日付が不正です');
        expect(prisma.evaluationPointThanks.findMany).not.toHaveBeenCalled();
    });

    it('期間の全員分を返す（admin・manager）', async () => {
        mock(prisma.evaluationPointThanks.findMany).mockResolvedValue([
            { id: 'a', fromUserId: 'foremanA', toUserId: 'worker1', date: utc0('2026-10-03'), message: 'ok', points: 2, createdAt: new Date('2026-10-03T01:00:00.000Z') },
        ]);
        mock(prisma.user.findMany).mockResolvedValue([{ id: 'foremanA', displayName: '職長A' }, { id: 'worker1', displayName: '作業員1' }]);
        for (const user of [ADMIN, MANAGER]) {
            loginAs(user);
            expect(await getThanks('startDate=2026-10-01&endDate=2026-10-31')).toEqual({
                status: 200,
                body: {
                    thanks: [{
                        id: 'a', date: '2026-10-03', fromUserId: 'foremanA', fromUserName: '職長A', toUserId: 'worker1', toUserName: '作業員1',
                        message: 'ok', points: 2, createdAt: '2026-10-03T01:00:00.000Z',
                    }],
                },
            });
        }
        expect(mock(prisma.evaluationPointThanks.findMany).mock.calls[0][0].where).toEqual({
            date: { gte: utc0('2026-10-01'), lt: utc0('2026-11-01') },
        });
    });
});
