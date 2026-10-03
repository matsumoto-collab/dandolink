/**
 * @jest-environment node
 *
 * 本人の点数と内訳の API のテスト（docs/指示書_評価ポイント.md の 6-4・8-1）。
 *   GET /api/evaluation-points/me?startDate=&endDate=
 *
 * @/lib/prisma と @/lib/api/utils は、jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * だから「自分の記録だけ」かは、findMany に渡した where の userId がセッションの ID であることで確かめる。
 */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/evaluation-points/me/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

const mock = (fn: unknown) => fn as jest.Mock;
const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockResolvedValue({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null });
const WORKER = { id: 'worker1', role: 'worker', name: '作業員1' };

const setting = (showToMembers: boolean, memberNotice: string | null = null) =>
    mock(prisma.evaluationPointSetting.findUnique).mockResolvedValue({ showToMembers, memberNotice });

interface MeBody {
    error?: string; details?: string;
    startDate?: string; endDate?: string; notice?: string | null;
    totalPoints?: number; totalCount?: number; pendingCount?: number;
    byItem?: { itemId: string; itemName: string; count: number; points: number }[];
    records?: Record<string, unknown>[];
}
const getMe = async (query = 'startDate=2026-09-01&endDate=2026-09-30') => {
    const res = await GET(new NextRequest(`http://localhost/api/evaluation-points/me?${query}`));
    return { status: res.status, body: (await res.json()) as MeBody, res };
};

/** 9月の作業員1 の記録（日付の新しい順で返ってくる想定）。洗車2回（確定）・ヘルプ1回（確定）・ヘルプ1回（確認待ち） */
const ROWS = [
    { id: 'r4', date: utc0('2026-09-20'), itemId: 'help', itemName: 'ヘルプ', points: 5, status: 'pending', createdByName: '作業員1', note: 'メモ' },
    { id: 'r3', date: utc0('2026-09-15'), itemId: 'help', itemName: 'ヘルプ（旧名）', points: 4, status: 'confirmed', createdByName: '職長A', note: null },
    { id: 'r2', date: utc0('2026-09-10'), itemId: 'wash', itemName: '洗車', points: 2, status: 'confirmed', createdByName: '職長A', note: 'ひみつ' },
    { id: 'r1', date: utc0('2026-09-01'), itemId: 'wash', itemName: '洗車', points: 3, status: 'confirmed', createdByName: '管理者1', note: null },
];

beforeEach(() => {
    jest.clearAllMocks();
    loginAs(WORKER);
    setting(true, '今は試しの期間です');
    mock(prisma.evaluationPointRecord.findMany).mockResolvedValue(ROWS);
    mock(prisma.evaluationPointItem.findMany).mockResolvedValue([
        { id: 'wash', name: '洗車', sortOrder: 0 },
        { id: 'help', name: 'ヘルプ', sortOrder: 1 },
    ]);
});

describe('GET /me', () => {
    it('公開がオフのとき worker（と職長）は 403。記録は読まない', async () => {
        setting(false);
        for (const role of ['worker', 'foreman1', 'foreman2']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            const r = await getMe();
            expect([role, r.status, r.body.error]).toEqual([role, 403, '権限がありません']);
        }
        expect(prisma.evaluationPointRecord.findMany).not.toHaveBeenCalled();
    });

    it('協力会社のメンバーなどは、公開がオンでも 403', async () => {
        for (const role of ['partner', 'partner_member', 'support', 'accountant']) {
            loginAs({ id: 'u1', role, name: 'だれか' });
            expect([role, (await getMe()).status]).toEqual([role, 403]);
        }
        expect(prisma.evaluationPointRecord.findMany).not.toHaveBeenCalled();
    });

    it('返るのは自分の記録だけ（where の userId がセッションの ID。クエリの userId は使わない）', async () => {
        const r = await getMe('startDate=2026-09-01&endDate=2026-09-30&userId=someone-else');
        expect(r.status).toBe(200);
        expect(mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0].where).toEqual({
            userId: 'worker1',
            date: { gte: utc0('2026-09-01'), lt: utc0('2026-10-01') },
        });
        expect(mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0].orderBy).toEqual([{ date: 'desc' }, { createdAt: 'desc' }]);
    });

    it('管理者・マネージャーも開ける（自分の分。公開がオフでも）', async () => {
        setting(false);
        for (const user of [{ id: 'admin1', role: 'admin', name: '管理者1' }, { id: 'manager1', role: 'manager', name: 'マネージャー1' }]) {
            mock(prisma.evaluationPointRecord.findMany).mockClear();
            loginAs(user);
            const r = await getMe();
            expect([user.role, r.status]).toEqual([user.role, 200]);
            expect(mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0].where.userId).toBe(user.id);
        }
    });

    it('合計・項目ごと・明細の形（確認待ちは合計に入らない・項目は今の名前で点数の多い順・付けた人とメモは返さない）', async () => {
        const { body } = await getMe();
        expect(body).toEqual({
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            notice: '今は試しの期間です',
            totalPoints: 9,
            totalCount: 3,
            pendingCount: 1,
            byItem: [
                { itemId: 'wash', itemName: '洗車', count: 2, points: 5 },
                { itemId: 'help', itemName: 'ヘルプ', count: 1, points: 4 },
            ],
            records: [
                { id: 'r4', date: '2026-09-20', itemName: 'ヘルプ', points: 5, status: 'pending' },
                { id: 'r3', date: '2026-09-15', itemName: 'ヘルプ（旧名）', points: 4, status: 'confirmed' },
                { id: 'r2', date: '2026-09-10', itemName: '洗車', points: 2, status: 'confirmed' },
                { id: 'r1', date: '2026-09-01', itemName: '洗車', points: 3, status: 'confirmed' },
            ],
        });
        // 付けた人・メモを DB からも読まない
        const select = mock(prisma.evaluationPointRecord.findMany).mock.calls[0][0].select;
        expect(select.createdByName).toBeUndefined();
        expect(select.note).toBeUndefined();
        expect(JSON.stringify(body)).not.toMatch(/職長A|管理者1|ひみつ|メモ/);
    });

    it('記録が無い期間は全部 0・注意書きが無ければ null', async () => {
        setting(true, null);
        mock(prisma.evaluationPointRecord.findMany).mockResolvedValue([]);
        const { body } = await getMe();
        expect(body).toMatchObject({ notice: null, totalPoints: 0, totalCount: 0, pendingCount: 0, byItem: [], records: [] });
        expect(prisma.evaluationPointItem.findMany).not.toHaveBeenCalled();
    });

    it('期間は必須・日付の形・開始 > 終了 は 400。応答は no-store', async () => {
        const none = await getMe('');
        expect([none.status, none.body.details]).toEqual([400, '入力が不正です']);
        const half = await getMe('startDate=2026-09-01');
        expect([half.status, half.body.details]).toEqual([400, '入力が不正です']);
        const bad = await getMe('startDate=2026-09-31&endDate=2026-10-01');
        expect([bad.status, bad.body.details]).toEqual([400, '日付が不正です']);
        const rev = await getMe('startDate=2026-10-01&endDate=2026-09-01');
        expect([rev.status, rev.body.details]).toEqual([400, '日付が不正です']);
        expect(prisma.evaluationPointRecord.findMany).not.toHaveBeenCalled();
        expect((await getMe()).res.headers.get('Cache-Control')).toBe('no-store');
    });
});
