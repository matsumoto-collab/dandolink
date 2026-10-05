/**
 * @jest-environment node
 *
 * GET /api/evaluation-points/thanks/me のテスト。
 *  - 対象のロールの人だけ（ほかは 403）。読むのは、セッションの本人の分だけ
 *  - 評価ポイントの見せ方（resolveAccessMode）が 'none' の人には、点数を返さない（null）
 */
import { GET } from '@/app/api/evaluation-points/thanks/me/route';
import { prisma } from '@/lib/prisma';
import {
    ADMIN, FOREMAN, MANAGER, NOW, OUTSIDERS, TODAY, WORKER,
    freezeNow, jsonRequest, loginAs, logout, mock, noThanksWrites, read, utc0,
} from './_helpers';

const PERIOD_QUERY = 'startDate=2026-10-01&endDate=2026-10-31';
const getMe = (query = PERIOD_QUERY) => GET(jsonRequest(`/api/evaluation-points/thanks/me?${query}`, 'GET')).then(read);
const RANGE = { gte: utc0('2026-10-01'), lt: utc0('2026-11-01') };

const row = (over: Record<string, unknown>) => ({
    message: null, points: 2, createdAt: new Date('2026-10-05T15:10:00.000Z'), ...over,
});

/** 評価ポイントの公開の設定（職長・作業員に点数を見せるか） */
const showToMembers = (on: boolean) =>
    mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue({ showToMembers: on, memberNotice: null });

beforeEach(() => {
    jest.clearAllMocks();
    freezeNow(NOW);
    loginAs(WORKER);
    showToMembers(true);
    mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive: true, pointsPerThanks: 2 });
    // where を見て、本物の DB と同じ答えにする（今日送った分・もらった・送った）
    mock(prisma.evaluationPointThanks.findMany).mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.toUserId === 'worker1') {
            return [row({ id: 'r1', fromUserId: 'foremanA', toUserId: 'worker1', date: utc0('2026-10-04'), message: 'ありがとう' })];
        }
        if (where.fromUserId === 'worker1' && where.date instanceof Date) return [{ toUserId: 'foremanA' }];
        if (where.fromUserId === 'worker1') {
            return [row({ id: 's1', fromUserId: 'worker1', toUserId: 'foremanA', date: utc0(TODAY), points: 2 })];
        }
        return [];
    });
    mock(prisma.user.findMany).mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        const all = [
            { id: 'foremanA', displayName: '職長A', role: 'FOREMAN1', dispatchSortOrder: 1, isActive: true },
            { id: 'worker1', displayName: '作業員1', role: 'worker', dispatchSortOrder: 2, isActive: true },
            { id: 'p1', displayName: '協力', role: 'partner', dispatchSortOrder: 0, isActive: true },
        ];
        const ids = (where.id as { in?: string[] } | undefined)?.in;
        return ids ? all.filter((u) => ids.includes(u.id)) : all.filter((u) => u.isActive);
    });
});

afterEach(() => {
    jest.useRealTimers();
});

describe('GET /api/evaluation-points/thanks/me', () => {
    it('ログインしていなければ 401', async () => {
        logout();
        expect((await getMe()).status).toBe(401);
    });

    it('対象外のロールは 403「権限がありません」で、何も読まない', async () => {
        for (const user of OUTSIDERS) {
            loginAs(user);
            const r = await getMe();
            expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointThanks.findMany).not.toHaveBeenCalled();
        expect(prisma.evaluationPointThanksSetting.findUnique).not.toHaveBeenCalled();
    });

    it('期間は必須（無い・片方・形が違えば 400）', async () => {
        expect((await getMe('')).body.details).toBe('入力が不正です');
        expect((await getMe('startDate=2026-10-01')).body.details).toBe('入力が不正です');
        expect((await getMe('startDate=2026-13-01&endDate=2026-10-31')).body.details).toBe('日付が不正です');
        expect(prisma.evaluationPointThanks.findMany).not.toHaveBeenCalled();
    });

    it('本人の分を全部返す（作業員・公開の設定がオン＝点数を見せる）', async () => {
        const res = await GET(jsonRequest(`/api/evaluation-points/thanks/me?${PERIOD_QUERY}`, 'GET'));
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(await read(res)).toEqual({
            status: 200,
            body: {
                startDate: '2026-10-01',
                endDate: '2026-10-31',
                active: true,
                showPoints: true,
                pointsPerThanks: 2,
                dailyLimit: 3,
                remainingToday: 2,
                sentTodayToIds: ['foremanA'],
                recipients: [{ userId: 'foremanA', displayName: '職長A' }],
                receivedCount: 1,
                receivedPoints: 2,
                received: [{ id: 'r1', date: '2026-10-04', fromUserName: '職長A', message: 'ありがとう', points: 2 }],
                sent: [{ id: 's1', date: TODAY, toUserId: 'foremanA', toUserName: '職長A', message: null, canRemove: true }],
            },
        });
        noThanksWrites();
    });

    it('読むのは自分の分だけ（where が toUserId: 自分・fromUserId: 自分）。クエリに userId を入れても変わらない', async () => {
        await getMe(`${PERIOD_QUERY}&userId=foremanA&toUserId=foremanA&fromUserId=foremanA`);
        const wheres = mock(prisma.evaluationPointThanks.findMany).mock.calls.map((c) => c[0].where);
        expect(wheres).toEqual(expect.arrayContaining([
            { fromUserId: 'worker1', date: utc0(TODAY) },
            { toUserId: 'worker1', date: RANGE },
            { fromUserId: 'worker1', date: RANGE },
        ]));
        expect(wheres).toHaveLength(3);
        for (const w of wheres) expect(JSON.stringify(w)).not.toContain('foremanA');
    });

    it('評価ポイントの見せ方が none（職長・作業員で公開の設定がオフ）なら、点数は null（回数・相手・ひとことは返す）', async () => {
        showToMembers(false);
        for (const user of [WORKER, FOREMAN]) {
            loginAs(user);
            const { status, body } = await getMe();
            expect(status).toBe(200);
            expect(body.showPoints).toBe(false);
            expect(body.pointsPerThanks).toBeNull();
            expect(body.receivedPoints).toBeNull();
            for (const r of body.received as { points: unknown }[]) expect(r.points).toBeNull();
        }
        loginAs(WORKER);
        const { body } = await getMe();
        expect(body.receivedCount).toBe(1);
        expect(body.received).toEqual([{ id: 'r1', date: '2026-10-04', fromUserName: '職長A', message: 'ありがとう', points: null }]);
    });

    it('管理者・マネージャーは、公開の設定がオフでも点数を見る', async () => {
        showToMembers(false);
        for (const user of [ADMIN, MANAGER]) {
            loginAs(user);
            const { body } = await getMe();
            expect([user.role, body.showPoints, body.pointsPerThanks]).toEqual([user.role, true, 2]);
        }
    });

    it('「使わない」のときは active: false・相手は空', async () => {
        mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive: false, pointsPerThanks: 2 });
        const { body } = await getMe();
        expect(body.active).toBe(false);
        expect(body.recipients).toEqual([]);
    });
});
