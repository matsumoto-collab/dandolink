/**
 * @jest-environment node
 *
 * GET /api/evaluation-points/thanks/access のテスト。
 */
import { GET } from '@/app/api/evaluation-points/thanks/access/route';
import { prisma } from '@/lib/prisma';
import { ADMIN, FOREMAN, FOREMAN2, MANAGER, OUTSIDERS, WORKER, loginAs, logout, mock, read } from './_helpers';

const getAccess = () => GET().then(read);

beforeEach(() => {
    jest.clearAllMocks();
    mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive: true, pointsPerThanks: 1 });
});

describe('GET /api/evaluation-points/thanks/access', () => {
    it('ログインしていなければ 401', async () => {
        logout();
        expect((await getAccess()).status).toBe(401);
    });

    it('対象のロールで「使う」なら enabled: true（応答は no-store）', async () => {
        for (const user of [ADMIN, MANAGER, FOREMAN, FOREMAN2, WORKER]) {
            loginAs(user);
            const res = await GET();
            expect(res.headers.get('Cache-Control')).toBe('no-store');
            expect([user.role, await read(res)]).toEqual([user.role, { status: 200, body: { enabled: true } }]);
        }
    });

    it('「使わない」・設定の行が無いなら enabled: false', async () => {
        loginAs(WORKER);
        mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive: false, pointsPerThanks: 1 });
        expect((await getAccess()).body).toEqual({ enabled: false });
        mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue(null);
        expect((await getAccess()).body).toEqual({ enabled: false });
    });

    it('対象外のロールは、DB を読まずに enabled: false', async () => {
        for (const user of OUTSIDERS) {
            loginAs(user);
            expect([user.role, await getAccess()]).toEqual([user.role, { status: 200, body: { enabled: false } }]);
        }
        expect(prisma.evaluationPointThanksSetting.findUnique).not.toHaveBeenCalled();
    });
});
