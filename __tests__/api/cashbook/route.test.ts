/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/cashbook/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: { storage: { from: () => ({ createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/s' } }) }) } },
    STORAGE_BUCKET: 'project-master-files',
}));

const mockSession = { user: { id: 'user-1', role: 'admin', isActive: true, canAccessCashbook: true } };
// 手打ち行（証憑なし）。storagePath が null なら署名URLの再生成パス（prisma.cashbookEntry.update）を通らない。
const manualRow = {
    id: 'c1',
    seq: 1,
    date: new Date(Date.UTC(2026, 6, 5)),
    settledAt: null,
    sortOrder: null,
    entryType: 'in',
    amount: 10000,
    storagePath: null,
    thumbnailPath: null,
    signedUrl: null,
    signedUrlExpiresAt: null,
    thumbnailSignedUrl: null,
    thumbnailSignedUrlExpiresAt: null,
};

describe('/api/cashbook GET', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
        (prisma.cashbookEntry.findMany as jest.Mock).mockResolvedValue([manualRow]);
        (prisma.cashbookEntry.groupBy as jest.Mock).mockResolvedValue([]);
    });

    it('month scope filters by settledAt-first (settledAt ?? date) range', async () => {
        const res = await GET(new NextRequest('http://localhost/api/cashbook?scope=month&year=2026&month=7'));
        expect(res.status).toBe(200);
        const arg = (prisma.cashbookEntry.findMany as jest.Mock).mock.calls[0][0];
        const monthStart = new Date(Date.UTC(2026, 6, 1));
        const monthEnd = new Date(Date.UTC(2026, 7, 1));
        // 清算日があればその月、なければ取引日の月に振り分ける OR 条件
        expect(arg.where.OR).toEqual([
            { settledAt: { gte: monthStart, lt: monthEnd } },
            { settledAt: null, date: { gte: monthStart, lt: monthEnd } },
        ]);
    });

    it('sorts by display date (settledAt ?? date) then sortOrder/seq', async () => {
        (prisma.cashbookEntry.findMany as jest.Mock).mockResolvedValue([
            // 取引日 7/20 だが清算日 7/2 → 先頭に来るべき
            { ...manualRow, id: 'late', seq: 5, date: new Date(Date.UTC(2026, 6, 20)), settledAt: new Date(Date.UTC(2026, 6, 2)) },
            // 同日 7/10 の2行: sortOrder 指定行が seq より前に来る
            { ...manualRow, id: 'b', seq: 3, date: new Date(Date.UTC(2026, 6, 10)), sortOrder: null },
            { ...manualRow, id: 'a', seq: 4, date: new Date(Date.UTC(2026, 6, 10)), sortOrder: 1.5 },
        ]);
        const res = await GET(new NextRequest('http://localhost/api/cashbook?scope=month&year=2026&month=7'));
        const body = await res.json();
        expect(body.entries.map((e: { id: string }) => e.id)).toEqual(['late', 'a', 'b']);
    });

    it('month scope computes openingBalance from prior in/out sums (settledAt-first)', async () => {
        (prisma.cashbookEntry.groupBy as jest.Mock).mockResolvedValue([
            { entryType: 'in', _sum: { amount: 50000 } },
            { entryType: 'out', _sum: { amount: 12000 } },
        ]);
        const res = await GET(new NextRequest('http://localhost/api/cashbook?scope=month&year=2026&month=7'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.openingBalance).toBe(38000);
        // 繰越の集計対象は当月開始より前の全期間（settledAt ?? date 基準）
        const groupArg = (prisma.cashbookEntry.groupBy as jest.Mock).mock.calls[0][0];
        const monthStart = new Date(Date.UTC(2026, 6, 1));
        expect(groupArg.where.OR).toEqual([
            { settledAt: { lt: monthStart } },
            { settledAt: null, date: { lt: monthStart } },
        ]);
    });

    it('month scope without year/month returns 400', async () => {
        const res = await GET(new NextRequest('http://localhost/api/cashbook?scope=month'));
        expect(res.status).toBe(400);
    });

    it('all scope has no date filter and openingBalance 0', async () => {
        const res = await GET(new NextRequest('http://localhost/api/cashbook?scope=all'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.openingBalance).toBe(0);
        const arg = (prisma.cashbookEntry.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({});
        expect(prisma.cashbookEntry.groupBy).not.toHaveBeenCalled();
    });

    it('403 without cashbook access', async () => {
        (canAccessCashbook as jest.Mock).mockReturnValueOnce(false);
        const res = await GET(new NextRequest('http://localhost/api/cashbook?scope=all'));
        expect(res.status).toBe(403);
    });
});

describe('/api/cashbook POST', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
        (prisma.cashbookEntry.create as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-1', seq: 2, ...data }));
    });

    const post = (body: unknown) =>
        POST(new NextRequest('http://localhost/api/cashbook', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

    it('creates a manual entry with defaults (amount 0 allowed for inline editing flow)', async () => {
        const res = await post({ date: '2026-07-05', entryType: 'in' });
        expect(res.status).toBe(201);
        const data = (prisma.cashbookEntry.create as jest.Mock).mock.calls[0][0].data;
        expect(data.date).toEqual(new Date('2026-07-05T00:00:00.000Z'));
        expect(data.entryType).toBe('in');
        expect(data.amount).toBe(0);
        expect(data.createdBy).toBe('user-1');
    });

    it('400 when date is missing or invalid', async () => {
        expect((await post({ entryType: 'in' })).status).toBe(400);
        expect((await post({ date: 'not-a-date', entryType: 'in' })).status).toBe(400);
    });

    it('400 for invalid entryType', async () => {
        expect((await post({ date: '2026-07-05', entryType: 'income' })).status).toBe(400);
    });

    it('400 for negative or non-numeric amount', async () => {
        expect((await post({ date: '2026-07-05', entryType: 'out', amount: -100 })).status).toBe(400);
        expect((await post({ date: '2026-07-05', entryType: 'out', amount: 'abc' })).status).toBe(400);
    });

    it('403 without cashbook access', async () => {
        (canAccessCashbook as jest.Mock).mockReturnValueOnce(false);
        expect((await post({ date: '2026-07-05', entryType: 'in' })).status).toBe(403);
    });
});
