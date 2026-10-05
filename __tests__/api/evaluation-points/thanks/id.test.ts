/**
 * @jest-environment node
 *
 * DELETE /api/evaluation-points/thanks/[id] のテスト。
 * 送った本人は送った日（日本時間）のうちだけ。管理者・マネージャーは、いつでも・だれの分でも。
 */
import { DELETE } from '@/app/api/evaluation-points/thanks/[id]/route';
import { prisma } from '@/lib/prisma';
import {
    ADMIN, FOREMAN, FOREMAN2, MANAGER, NOW, OUTSIDERS, TODAY, WORKER,
    freezeNow, jsonRequest, loginAs, logout, mock, noThanksWrites, read, utc0,
} from './_helpers';

const deleteThanks = (id: string) => DELETE(jsonRequest(`/api/evaluation-points/thanks/${id}`, 'DELETE'), { params: { id } }).then(read);

const FORBIDDEN = '取り消せるのは、送った本人（送った日のうち）と、管理者・マネージャーです';

const row = (over: Record<string, unknown> = {}) => ({
    id: 't1', fromUserId: 'foremanA', toUserId: 'worker1', date: utc0(TODAY), message: null, points: 1,
    createdAt: new Date('2026-10-05T15:10:00.000Z'), ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    freezeNow(NOW);
    loginAs(FOREMAN);
    mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(row());
    mock(prisma.evaluationPointThanks.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.evaluationPointLog.create).mockResolvedValue({});
});

afterEach(() => {
    jest.useRealTimers();
});

describe('DELETE /api/evaluation-points/thanks/[id]', () => {
    it('ログインしていなければ 401', async () => {
        logout();
        expect((await deleteThanks('t1')).status).toBe(401);
        noThanksWrites();
    });

    it('対象外のロールは 403「権限がありません」で、何も読まず書かない', async () => {
        for (const user of OUTSIDERS) {
            loginAs(user);
            const r = await deleteThanks('t1');
            expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointThanks.findUnique).not.toHaveBeenCalled();
        noThanksWrites();
    });

    it('送った本人の当日（日本時間）の分は取り消せる → { ok: true }・ログ', async () => {
        expect(await deleteThanks('t1')).toEqual({ status: 200, body: { ok: true } });
        expect(mock(prisma.evaluationPointThanks.deleteMany).mock.calls[0][0]).toEqual({ where: { id: 't1' } });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toMatchObject({ action: 'thanks_removed', actorId: 'foremanA', recordId: 't1' });
    });

    it('送った本人でも、前の日の分は 403', async () => {
        mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(row({ date: utc0('2026-10-05') }));
        const r = await deleteThanks('t1');
        expect([r.status, r.body.error]).toEqual([403, FORBIDDEN]);
        noThanksWrites();
    });

    it('ほかの職長・作業員は 403', async () => {
        for (const user of [FOREMAN2, WORKER]) {
            loginAs(user);
            const r = await deleteThanks('t1');
            expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, FORBIDDEN]);
        }
        noThanksWrites();
    });

    it('管理者・マネージャーは、前の日の・ほかの人の分も取り消せる', async () => {
        mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(row({ date: utc0('2026-09-01') }));
        for (const user of [ADMIN, MANAGER]) {
            loginAs(user);
            expect(await deleteThanks('t1')).toEqual({ status: 200, body: { ok: true } });
        }
        expect(prisma.evaluationPointThanks.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('無ければ 404「「ありがとう」が見つかりません」', async () => {
        mock(prisma.evaluationPointThanks.findUnique).mockResolvedValue(null);
        const r = await deleteThanks('nope');
        expect([r.status, r.body.error]).toEqual([404, '「ありがとう」が見つかりません']);
        noThanksWrites();
    });

    it('読んだあとで先に消されていたら 404 で、ログを書かない', async () => {
        mock(prisma.evaluationPointThanks.deleteMany).mockResolvedValue({ count: 0 });
        const r = await deleteThanks('t1');
        expect([r.status, r.body.error]).toEqual([404, '「ありがとう」が見つかりません']);
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });
});
