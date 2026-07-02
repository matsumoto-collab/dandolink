/**
 * @jest-environment node
 */
import { GET, PATCH, DELETE } from '@/app/api/receipts/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { NextRequest } from 'next/server';

// storage は from() が安定した jest.fn() を返すようにする（呼び出し引数をテストで検証するため）
jest.mock('@/lib/supabase-admin', () => {
    const remove = jest.fn().mockResolvedValue({ error: null });
    const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/s' } });
    const download = jest.fn();
    const upload = jest.fn().mockResolvedValue({ error: null });
    return {
        supabaseAdmin: { storage: { from: () => ({ remove, createSignedUrl, download, upload }) } },
        STORAGE_BUCKET: 'project-master-files',
        __mocks: { remove, createSignedUrl, download, upload },
    };
});

const { __mocks } = jest.requireMock('@/lib/supabase-admin');

const mockSession = { user: { id: 'user-1', role: 'manager', isActive: true } };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const future = new Date(Date.now() + 60 * 60 * 1000);

// 署名URLが有効な pending 領収書（GET で再署名パスを通さないため expiresAt は未来）
const basePending = {
    id: 'r1',
    status: 'pending',
    fileName: 'r.webp',
    storagePath: 'receipts/r1.webp',
    thumbnailPath: 'receipts/r1_thumb.webp',
    mimeType: 'image/webp',
    signedUrl: 'https://example.test/s',
    signedUrlExpiresAt: future,
    thumbnailSignedUrl: 'https://example.test/t',
    thumbnailSignedUrlExpiresAt: future,
    issueDate: null as Date | null,
    totalAmount: null as unknown,
    expenseCategoryId: null as string | null,
};

const patchReq = (id: string, body: unknown) =>
    new NextRequest(`http://localhost/api/receipts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

describe('/api/receipts/[id]', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
    });

    describe('GET', () => {
        it('returns the receipt', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(basePending);
            const res = await GET(new NextRequest('http://localhost/api/receipts/r1'), ctx('r1'));
            expect(res.status).toBe(200);
        });
        it('404 when missing', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await GET(new NextRequest('http://localhost/api/receipts/r1'), ctx('r1'));
            expect(res.status).toBe(404);
        });
    });

    describe('PATCH — field edits', () => {
        it('updates fields while pending', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(basePending);
            (prisma.receipt.update as jest.Mock).mockResolvedValue({ ...basePending, storeName: 'セブン' });

            const res = await PATCH(patchReq('r1', { storeName: 'セブン', totalAmount: '1,500' }), ctx('r1'));
            expect(res.status).toBe(200);
            const arg = (prisma.receipt.update as jest.Mock).mock.calls[0][0];
            expect(arg.where).toEqual({ id: 'r1' });
            expect(arg.data.storeName).toBe('セブン');
            expect(arg.data.totalAmount).toBe(1500); // カンマ除去して数値化
        });

        it('rejects field edits on a confirmed receipt (400)', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue({ ...basePending, status: 'confirmed' });
            const res = await PATCH(patchReq('r1', { storeName: 'x' }), ctx('r1'));
            expect(res.status).toBe(400);
            expect(prisma.receipt.update).not.toHaveBeenCalled();
        });

        it('rejects an invalid paymentMethod (400)', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(basePending);
            const res = await PATCH(patchReq('r1', { paymentMethod: 'bitcoin' }), ctx('r1'));
            expect(res.status).toBe(400);
        });

        it('404 when missing', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await PATCH(patchReq('r1', { storeName: 'x' }), ctx('r1'));
            expect(res.status).toBe(404);
        });
    });

    describe('PATCH — confirm gate', () => {
        it('confirms when date+amount+category are present', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(basePending);
            (prisma.receipt.update as jest.Mock).mockResolvedValue({ ...basePending, status: 'confirmed' });

            const res = await PATCH(patchReq('r1', { issueDate: '2026-07-01', totalAmount: '1500', expenseCategoryId: 'cat1', status: 'confirmed' }), ctx('r1'));
            expect(res.status).toBe(200);
            const arg = (prisma.receipt.update as jest.Mock).mock.calls[0][0];
            expect(arg.data.status).toBe('confirmed');
            expect(arg.data.confirmedBy).toBe('user-1');
            expect(arg.data.confirmedAt).toBeInstanceOf(Date);
        });

        it('blocks confirm when issueDate missing', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(basePending);
            const res = await PATCH(patchReq('r1', { totalAmount: '1500', expenseCategoryId: 'cat1', status: 'confirmed' }), ctx('r1'));
            expect(res.status).toBe(400);
            expect(prisma.receipt.update).not.toHaveBeenCalled();
        });

        it('blocks confirm when amount is 0', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(basePending);
            const res = await PATCH(patchReq('r1', { issueDate: '2026-07-01', totalAmount: '0', expenseCategoryId: 'cat1', status: 'confirmed' }), ctx('r1'));
            expect(res.status).toBe(400);
        });

        it('blocks confirm when category missing (uses current value)', async () => {
            // 現在値に費目なし・body でも費目を送らない → マージ結果でも費目なし
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue({ ...basePending, issueDate: new Date('2026-07-01T00:00:00Z'), totalAmount: 1500, expenseCategoryId: null });
            const res = await PATCH(patchReq('r1', { status: 'confirmed' }), ctx('r1'));
            expect(res.status).toBe(400);
        });

        it('confirms using merged current values when body omits fields', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue({ ...basePending, issueDate: new Date('2026-07-01T00:00:00Z'), totalAmount: 1500, expenseCategoryId: 'cat1' });
            (prisma.receipt.update as jest.Mock).mockResolvedValue({ ...basePending, status: 'confirmed' });
            const res = await PATCH(patchReq('r1', { status: 'confirmed' }), ctx('r1'));
            expect(res.status).toBe(200);
        });
    });

    describe('PATCH — reopen', () => {
        it('reopens a confirmed receipt and clears confirm audit', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue({ ...basePending, status: 'confirmed' });
            (prisma.receipt.update as jest.Mock).mockResolvedValue({ ...basePending, status: 'pending' });

            const res = await PATCH(patchReq('r1', { status: 'pending' }), ctx('r1'));
            expect(res.status).toBe(200);
            const arg = (prisma.receipt.update as jest.Mock).mock.calls[0][0];
            expect(arg.data.status).toBe('pending');
            expect(arg.data.confirmedAt).toBeNull();
            expect(arg.data.confirmedBy).toBeNull();
        });

        it('rejects an unknown status (400)', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue({ ...basePending, status: 'confirmed' });
            const res = await PATCH(patchReq('r1', { status: 'weird' }), ctx('r1'));
            expect(res.status).toBe(400);
        });
    });

    describe('PATCH — settled', () => {
        it('marks settled on a confirmed receipt without hitting the field-edit gate', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue({ ...basePending, status: 'confirmed' });
            (prisma.receipt.update as jest.Mock).mockResolvedValue({ ...basePending, status: 'confirmed', settled: true });
            const res = await PATCH(patchReq('r1', { settled: true }), ctx('r1'));
            expect(res.status).toBe(200);
            const arg = (prisma.receipt.update as jest.Mock).mock.calls[0][0];
            expect(arg.data.settled).toBe(true);
            expect(arg.data.settledAt).toBeInstanceOf(Date);
            expect(arg.data.settledBy).toBe('user-1');
        });

        it('clears the settled audit when set to false', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue({ ...basePending, status: 'confirmed', settled: true });
            (prisma.receipt.update as jest.Mock).mockResolvedValue({ ...basePending });
            const res = await PATCH(patchReq('r1', { settled: false }), ctx('r1'));
            expect(res.status).toBe(200);
            const arg = (prisma.receipt.update as jest.Mock).mock.calls[0][0];
            expect(arg.data.settled).toBe(false);
            expect(arg.data.settledAt).toBeNull();
            expect(arg.data.settledBy).toBeNull();
        });
    });

    describe('DELETE', () => {
        it('removes storage files and deletes the row when the image is not shared', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(basePending);
            (prisma.receipt.count as jest.Mock).mockResolvedValue(0); // 共有なし
            (prisma.receipt.delete as jest.Mock).mockResolvedValue(basePending);

            const res = await DELETE(new NextRequest('http://localhost/api/receipts/r1', { method: 'DELETE' }), ctx('r1'));
            expect(res.status).toBe(200);
            expect(__mocks.remove).toHaveBeenCalledWith(['receipts/r1.webp', 'receipts/r1_thumb.webp']);
            expect(prisma.receipt.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
        });

        it('keeps storage when another receipt shares the same image (multi-split)', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(basePending);
            (prisma.receipt.count as jest.Mock).mockResolvedValue(1); // 同じ画像を共有する別の領収書がある
            (prisma.receipt.delete as jest.Mock).mockResolvedValue(basePending);

            const res = await DELETE(new NextRequest('http://localhost/api/receipts/r1', { method: 'DELETE' }), ctx('r1'));
            expect(res.status).toBe(200);
            expect(__mocks.remove).not.toHaveBeenCalled();
            expect(prisma.receipt.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
        });

        it('404 when missing', async () => {
            (prisma.receipt.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await DELETE(new NextRequest('http://localhost/api/receipts/r1', { method: 'DELETE' }), ctx('r1'));
            expect(res.status).toBe(404);
            expect(prisma.receipt.delete).not.toHaveBeenCalled();
        });
    });
});
