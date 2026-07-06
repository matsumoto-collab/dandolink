/**
 * @jest-environment node
 */
import { GET } from '@/app/api/receipts/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { isManagerOrAbove, isManagerOrAccountant } from '@/utils/permissions';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: { storage: { from: () => ({ createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/s' } }) }) } },
    STORAGE_BUCKET: 'project-master-files',
}));

const mockSession = { user: { id: 'user-1', role: 'manager', isActive: true } };
const future = new Date(Date.now() + 60 * 60 * 1000);
// thumbnailPath を null にし、署名URLも有効にして再署名パス（prisma.receipt.update）を回避する
const row = {
    id: 'r1',
    storagePath: 'receipts/r1.webp',
    thumbnailPath: null,
    signedUrl: 'https://example.test/s',
    signedUrlExpiresAt: future,
    thumbnailSignedUrl: null,
    thumbnailSignedUrlExpiresAt: null,
};

describe('/api/receipts GET', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
        (isManagerOrAccountant as jest.Mock).mockReturnValue(true);
        (prisma.receipt.findMany as jest.Mock).mockResolvedValue([row]);
    });

    it('filters by status=pending and orders by createdAt desc', async () => {
        const res = await GET(new NextRequest('http://localhost/api/receipts?status=pending'));
        expect(res.status).toBe(200);
        const arg = (prisma.receipt.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ status: 'pending' });
        expect(arg.orderBy).toEqual([{ createdAt: 'desc' }]);
    });

    it('filters confirmed by month via issueDate range', async () => {
        const res = await GET(new NextRequest('http://localhost/api/receipts?status=confirmed&year=2026&month=7'));
        expect(res.status).toBe(200);
        const arg = (prisma.receipt.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where.status).toBe('confirmed');
        expect(arg.where.issueDate.gte).toEqual(new Date(Date.UTC(2026, 6, 1)));
        expect(arg.where.issueDate.lt).toEqual(new Date(Date.UTC(2026, 7, 1)));
        expect(arg.orderBy).toEqual([{ issueDate: 'asc' }, { createdAt: 'asc' }]);
    });

    it('confirmed without year/month has no issueDate filter', async () => {
        const res = await GET(new NextRequest('http://localhost/api/receipts?status=confirmed'));
        expect(res.status).toBe(200);
        const arg = (prisma.receipt.findMany as jest.Mock).mock.calls[0][0];
        expect(arg.where).toEqual({ status: 'confirmed' });
    });

    it('403 for a role without finance view access', async () => {
        // GET の閲覧ガードは isManagerOrAccountant（税理士にも開放）に変わった
        (isManagerOrAccountant as jest.Mock).mockReturnValueOnce(false);
        const res = await GET(new NextRequest('http://localhost/api/receipts?status=pending'));
        expect(res.status).toBe(403);
    });
});
