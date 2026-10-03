/**
 * @jest-environment node
 *
 * 評価ポイントの見せ方の API のテスト（docs/指示書_評価ポイント.md の 6-4・8-1）。
 *   GET /api/evaluation-points/access
 *
 * @/lib/prisma と @/lib/api/utils は、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 */
import { NextResponse } from 'next/server';
import { GET } from '@/app/api/evaluation-points/access/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;

/** username（ログイン名）は、わざと id と違う値にする */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });

const setting = (showToMembers: boolean | null) =>
    mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue(
        showToMembers === null ? null : { showToMembers, memberNotice: null },
    );

const getAccess = async () => {
    const res = await GET();
    return { status: res.status, body: (await res.json()) as { mode?: string; error?: string }, res };
};

beforeEach(() => {
    jest.clearAllMocks();
    setting(false);
});

describe('GET /access', () => {
    it('公開がオフのとき、worker・foreman1・foreman2 は none', async () => {
        for (const role of ['worker', 'foreman1', 'foreman2']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await getAccess();
            expect([role, r.status, r.body.mode]).toEqual([role, 200, 'none']);
        }
    });

    it('公開の行が無いときも、worker は none', async () => {
        setting(null);
        loginAs({ id: 'worker1', role: 'worker', name: '作業員1' });
        expect((await getAccess()).body.mode).toBe('none');
    });

    it('公開がオンのとき、worker・foreman1・foreman2 は member', async () => {
        setting(true);
        for (const role of ['worker', 'foreman1', 'foreman2']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            expect([role, (await getAccess()).body.mode]).toEqual([role, 'member']);
        }
    });

    it('admin・manager は、公開の設定に関係なく manager', async () => {
        for (const on of [false, true]) {
            setting(on);
            for (const role of ['admin', 'manager']) {
                loginAs({ id: 'u1', role, name: 'だれか' });
                expect([on, role, (await getAccess()).body.mode]).toEqual([on, role, 'manager']);
            }
        }
    });

    it('協力会社・協力会社のメンバー・応援・税理士は、公開がオンでも none', async () => {
        setting(true);
        for (const role of ['partner', 'partner_member', 'support', 'accountant']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            expect([role, (await getAccess()).body.mode]).toEqual([role, 'none']);
        }
    });

    it('ログインしていなければ、requireAuth の答え（401）をそのまま返す。応答は no-store', async () => {
        mock(requireAuth).mockResolvedValueOnce({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) });
        expect((await getAccess()).status).toBe(401);
        loginAs({ id: 'worker1', role: 'worker' });
        expect((await getAccess()).res.headers.get('Cache-Control')).toBe('no-store');
    });
});
