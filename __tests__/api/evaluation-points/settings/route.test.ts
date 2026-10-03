/**
 * @jest-environment node
 *
 * 公開の設定の API のテスト（docs/指示書_評価ポイント.md の 6-4・8-1）。
 *   GET・PUT /api/evaluation-points/settings
 *
 * @/lib/prisma と @/lib/api/utils は、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * $transaction のモックは、コールバックに prisma のモックをそのまま渡す。
 */
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/evaluation-points/settings/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };

interface Body { error?: string; details?: string; showToMembers?: boolean; memberNotice?: string | null }
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Body, res });
const put = (body: unknown) =>
    PUT(new NextRequest('http://localhost/api/evaluation-points/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    })).then(read);

const settingRow = (row: { showToMembers: boolean; memberNotice: string | null } | null) =>
    mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue(row);

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(ADMIN);
    settingRow({ showToMembers: false, memberNotice: null });
    mock(prisma.evaluationPointSetting.upsert).mockResolvedValue({ id: 'default' });
    mock(prisma.evaluationPointLog.create).mockResolvedValue({ id: 'log1' });
});

describe('GET /settings', () => {
    it('admin は今の設定を読める（no-store）', async () => {
        settingRow({ showToMembers: true, memberNotice: '試しの期間です' });
        const r = await read(await GET());
        expect([r.status, r.body]).toEqual([200, { showToMembers: true, memberNotice: '試しの期間です' }]);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('行が無ければ「見せない・注意書きなし」', async () => {
        settingRow(null);
        const r = await read(await GET());
        expect(r.body).toEqual({ showToMembers: false, memberNotice: null });
    });

    it('admin 以外は 403（manager も）', async () => {
        for (const role of ['manager', 'foreman1', 'worker', 'partner']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await read(await GET());
            expect([role, r.status, r.body.error]).toEqual([role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointSetting.findUnique).not.toHaveBeenCalled();
    });
});

describe('PUT /settings', () => {
    it('admin 以外の PUT は 403（manager も）。何も書かない', async () => {
        for (const role of ['manager', 'foreman1', 'foreman2', 'worker', 'partner_member', 'accountant']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await put({ showToMembers: true, memberNotice: null });
            expect([role, r.status, r.body.error]).toEqual([role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointSetting.upsert).not.toHaveBeenCalled();
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });

    it('オンにすると upsert（行が無ければ作る）と setting_updated のログを、同じトランザクションで書く', async () => {
        const r = await put({ showToMembers: true, memberNotice: '  今は試しの期間です  ' });
        expect([r.status, r.body]).toEqual([200, { showToMembers: true, memberNotice: '今は試しの期間です' }]);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.evaluationPointSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'default' },
            create: { id: 'default', showToMembers: true, memberNotice: '今は試しの期間です', updatedBy: 'admin1' },
            update: { showToMembers: true, memberNotice: '今は試しの期間です', updatedBy: 'admin1' },
        }));
        expect(prisma.evaluationPointLog.create).toHaveBeenCalledWith({
            data: {
                action: 'setting_updated',
                actorId: 'admin1',
                actorName: '管理者1',
                detail: {
                    before: { showToMembers: false, memberNotice: null },
                    after: { showToMembers: true, memberNotice: '今は試しの期間です' },
                },
            },
        });
    });

    it('行が無いときも upsert で作る（before は「見せない・注意書きなし」）', async () => {
        settingRow(null);
        const r = await put({ showToMembers: false, memberNotice: null });
        expect(r.status).toBe(200);
        expect(prisma.evaluationPointSetting.upsert).toHaveBeenCalledTimes(1);
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data.detail).toEqual({
            before: { showToMembers: false, memberNotice: null },
            after: { showToMembers: false, memberNotice: null },
        });
    });

    it('名前が無い session でも、actorName は username（id ではない）', async () => {
        loginAs({ id: 'admin1', role: 'admin' });
        await put({ showToMembers: true, memberNotice: null });
        expect(mock(prisma.evaluationPointLog.create).mock.calls[0][0].data.actorName).toBe('login-admin1');
    });

    it('中身が今と同じなら、書かない（ログも書かない）', async () => {
        settingRow({ showToMembers: true, memberNotice: 'メモ' });
        const r = await put({ showToMembers: true, memberNotice: 'メモ' });
        expect([r.status, r.body]).toEqual([200, { showToMembers: true, memberNotice: 'メモ' }]);
        expect(prisma.evaluationPointSetting.upsert).not.toHaveBeenCalled();
        expect(prisma.evaluationPointLog.create).not.toHaveBeenCalled();
    });

    it('空の注意書き・省いた注意書きは null', async () => {
        for (const body of [{ showToMembers: true, memberNotice: '   ' }, { showToMembers: true }]) {
            mock(prisma.evaluationPointSetting.upsert).mockClear();
            const r = await put(body);
            expect(r.body.memberNotice).toBeNull();
            expect(mock(prisma.evaluationPointSetting.upsert).mock.calls[0][0].update.memberNotice).toBeNull();
        }
    });

    it('形のまちがいは 400「入力が不正です」（showToMembers が boolean でない・注意書きが 200字を超える・文字列でない・JSON でない）', async () => {
        const cases: unknown[] = [
            { memberNotice: null },
            { showToMembers: 'true', memberNotice: null },
            { showToMembers: 1, memberNotice: null },
            { showToMembers: true, memberNotice: 'あ'.repeat(201) },
            { showToMembers: true, memberNotice: 123 },
            [true],
            'not json',
        ];
        for (const body of cases) {
            const r = await put(body);
            expect([body, r.status, r.body.details]).toEqual([body, 400, '入力が不正です']);
        }
        expect(prisma.evaluationPointSetting.upsert).not.toHaveBeenCalled();
        // 200字ちょうどは通る
        expect((await put({ showToMembers: true, memberNotice: 'あ'.repeat(200) })).status).toBe(200);
    });
});
