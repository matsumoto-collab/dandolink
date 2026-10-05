/**
 * @jest-environment node
 *
 * GET・PUT /api/evaluation-points/thanks/settings のテスト（admin だけ）。
 */
import { GET, PUT } from '@/app/api/evaluation-points/thanks/settings/route';
import { prisma } from '@/lib/prisma';
import { ADMIN, FOREMAN, MANAGER, OUTSIDERS, WORKER, jsonRequest, loginAs, logout, mock, noThanksWrites, read } from './_helpers';

const getSettings = () => GET().then(read);
const putSettings = (body: unknown) => PUT(jsonRequest('/api/evaluation-points/thanks/settings', 'PUT', body)).then(read);

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(ADMIN);
    mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive: false, pointsPerThanks: 1 });
    mock(prisma.evaluationPointThanksSetting.upsert).mockResolvedValue({ id: 'default' });
    mock(prisma.evaluationPointLog.create).mockResolvedValue({});
});

describe('権限', () => {
    it('ログインしていなければ 401', async () => {
        logout();
        expect((await getSettings()).status).toBe(401);
        expect((await putSettings({ isActive: true })).status).toBe(401);
        noThanksWrites();
    });

    it('admin 以外（マネージャー・職長・作業員・対象外）は 403「権限がありません」で、何も読まず書かない', async () => {
        for (const user of [MANAGER, FOREMAN, WORKER, ...OUTSIDERS]) {
            loginAs(user);
            for (const r of [await getSettings(), await putSettings({ isActive: true })]) {
                expect([user.role, r.status, r.body.error]).toEqual([user.role, 403, '権限がありません']);
            }
        }
        expect(prisma.evaluationPointThanksSetting.findUnique).not.toHaveBeenCalled();
        noThanksWrites();
    });
});

describe('GET', () => {
    it('今の設定（行が無ければ 使わない・1点）', async () => {
        expect(await getSettings()).toEqual({ status: 200, body: { isActive: false, pointsPerThanks: 1 } });
        mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue({ isActive: true, pointsPerThanks: 7 });
        expect((await getSettings()).body).toEqual({ isActive: true, pointsPerThanks: 7 });
        mock(prisma.evaluationPointThanksSetting.findUnique).mockResolvedValue(null);
        expect((await getSettings()).body).toEqual({ isActive: false, pointsPerThanks: 1 });
    });
});

describe('PUT', () => {
    it('使う にする → 保存した中身を返す。更新者は admin のセッションの id', async () => {
        expect(await putSettings({ isActive: true })).toEqual({ status: 200, body: { isActive: true, pointsPerThanks: 1 } });
        expect(mock(prisma.evaluationPointThanksSetting.upsert).mock.calls[0][0].update).toEqual({ isActive: true, pointsPerThanks: 1, updatedBy: 'admin1' });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data).toMatchObject({
            action: 'thanks_setting_updated', actorId: 'admin1', detail: { before: { isActive: false }, after: { isActive: true } },
        });
    });

    it('点数だけ変える（0 と 9999 も受け付ける）', async () => {
        expect((await putSettings({ pointsPerThanks: 0 })).body).toEqual({ isActive: false, pointsPerThanks: 0 });
        expect((await putSettings({ pointsPerThanks: 9999 })).body).toEqual({ isActive: false, pointsPerThanks: 9999 });
    });

    it('形が違えば 400「入力が不正です」で、何も書かない', async () => {
        for (const body of [{}, null, [], 'x', '{bad json', { isActive: 'true' }, { isActive: null }, { pointsPerThanks: '3' }, { pointsPerThanks: null }, { isActive: 1 }]) {
            const r = await putSettings(body);
            expect([body, r.status, r.body.details]).toEqual([body, 400, '入力が不正です']);
        }
        noThanksWrites();
    });

    it('点数が 0〜9999 の整数でなければ 400「点数は 0〜9999 の整数で入れてください」で、何も書かない', async () => {
        for (const pointsPerThanks of [-1, 10000, 1.5]) {
            const r = await putSettings({ isActive: true, pointsPerThanks });
            expect([pointsPerThanks, r.status, r.body.error]).toEqual([pointsPerThanks, 400, '点数は 0〜9999 の整数で入れてください']);
        }
        noThanksWrites();
    });
});
