/**
 * @jest-environment node
 *
 * GET /api/joyo-statements/access（支払明細書の画面の見せ方）のテスト。
 *   admin（大文字まじりも）→ 'admin'（対象者の表は読まない）
 *   それ以外で、支払明細書の対象者（JoyoContractor.userId = セッションの id）の行がある → 'member'（利用停止でも）
 *   行が無い → 'none'
 */
import { NextResponse } from 'next/server';
import { GET, dynamic } from '@/app/api/joyo-statements/access/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { contractorRow } from './_fixtures';

const loginAs = (user: { id: string; role?: string | null }) =>
    (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { isActive: true, ...user } }, error: null });

const getAccess = async () => {
    const res = await GET();
    return { status: res.status, body: (await res.json()) as { mode?: string }, cache: res.headers.get('Cache-Control') };
};

beforeEach(() => {
    jest.clearAllMocks();
    (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue(null);
});

describe('GET /api/joyo-statements/access', () => {
    it("admin は 'admin'（大文字まじりも）。対象者の表は読まない", async () => {
        for (const role of ['admin', 'ADMIN', 'Admin']) {
            loginAs({ id: 'admin-1', role });
            const r = await getAccess();
            expect([role, r.status, r.body, r.cache]).toEqual([role, 200, { mode: 'admin' }, 'no-store']);
        }
        expect(prisma.joyoContractor.findUnique).not.toHaveBeenCalled();
    });

    it("対象者の行がある職長・作業員・マネージャーは 'member'", async () => {
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
        for (const role of ['foreman1', 'foreman2', 'worker', 'manager', 'FOREMAN1']) {
            loginAs({ id: 'u-1', role });
            const r = await getAccess();
            expect([role, r.status, r.body]).toEqual([role, 200, { mode: 'member' }]);
        }
    });

    it("利用停止の対象者でも 'member'（isActive で絞らない）", async () => {
        loginAs({ id: 'u-1', role: 'worker' });
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue({ id: 'c-1' });
        expect((await getAccess()).body).toEqual({ mode: 'member' });
        const arg = (prisma.joyoContractor.findUnique as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ userId: 'u-1' });
        expect(JSON.stringify(arg)).not.toContain('isActive');
        // 利用停止の行（モックは where を見ないので、行の中身で確かめる）
        (prisma.joyoContractor.findUnique as jest.Mock).mockResolvedValue(contractorRow({ isActive: false }));
        expect((await getAccess()).body).toEqual({ mode: 'member' });
    });

    it("対象者の行が無ければ 'none'", async () => {
        for (const role of ['foreman2', 'worker', 'manager', 'partner', 'accountant']) {
            loginAs({ id: 'u-9', role });
            const r = await getAccess();
            expect([role, r.status, r.body]).toEqual([role, 200, { mode: 'none' }]);
        }
    });

    it('対象者を引くときの where は userId: <セッションの id>', async () => {
        loginAs({ id: 'session-user-42', role: 'foreman1' });
        await getAccess();
        expect(prisma.joyoContractor.findUnique).toHaveBeenCalledTimes(1);
        expect((prisma.joyoContractor.findUnique as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 'session-user-42' });
    });

    it('ログインしていなければ 401（DB は読まない）', async () => {
        const unauthorized = NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: unauthorized });
        const res = await GET();
        expect(res.status).toBe(401);
        expect(prisma.joyoContractor.findUnique).not.toHaveBeenCalled();
    });

    it("毎回サーバーで実行する（dynamic = 'force-dynamic'）", () => {
        expect(dynamic).toBe('force-dynamic');
    });
});
