/**
 * @jest-environment node
 */
import { GET } from '@/app/api/card-receipts/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: { storage: { from: () => ({ createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/s' } }) }) } },
    STORAGE_BUCKET: 'project-master-files',
}));

const mockSession = { user: { id: 'user-1', role: 'admin', isActive: true, canAccessCashbook: true } };
const future = new Date(Date.now() + 60 * 60 * 1000);
// thumbnailPath を null にし、署名URLも有効にして再署名パス（prisma.cardReceipt.update）を回避する
const row = {
    id: 'cr1',
    storagePath: 'card-receipts/cr1.webp',
    thumbnailPath: null,
    signedUrl: 'https://example.test/s',
    signedUrlExpiresAt: future,
    thumbnailSignedUrl: null,
    thumbnailSignedUrlExpiresAt: null,
};

describe('/api/card-receipts GET', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
        (prisma.cardReceipt.findMany as jest.Mock).mockResolvedValue([row]);
    });

    it('returns all receipts without a linked filter, ordered by receipt date (oldest first, undated last)', async () => {
        const res = await GET(new NextRequest('http://localhost/api/card-receipts'));
        expect(res.status).toBe(200);
        const arg = (prisma.cardReceipt.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({});
        expect(arg.orderBy).toEqual([{ issueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]);
    });

    it('filters unlinked receipts via statementLine: null', async () => {
        await GET(new NextRequest('http://localhost/api/card-receipts?linked=unlinked'));
        const arg = (prisma.cardReceipt.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ statementLine: null });
    });

    it('filters linked receipts via NOT statementLine: null', async () => {
        await GET(new NextRequest('http://localhost/api/card-receipts?linked=linked'));
        const arg = (prisma.cardReceipt.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ NOT: { statementLine: null } });
    });

    it('403 without the cashbook access flag (even for admin)', async () => {
        (canAccessCashbook as jest.Mock).mockReturnValueOnce(false);
        const res = await GET(new NextRequest('http://localhost/api/card-receipts'));
        expect(res.status).toBe(403);
    });
});
