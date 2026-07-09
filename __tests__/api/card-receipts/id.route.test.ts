/**
 * @jest-environment node
 */
import { PATCH, DELETE } from '@/app/api/card-receipts/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { NextRequest } from 'next/server';

const removeMock = jest.fn().mockResolvedValue({ error: null });
jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: { storage: { from: () => ({ remove: (...args: unknown[]) => removeMock(...args) }) } },
    STORAGE_BUCKET: 'project-master-files',
}));

const mockSession = { user: { id: 'user-1', role: 'admin', isActive: true, canAccessCashbook: true } };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (body: unknown) =>
    new NextRequest('http://localhost/api/card-receipts/cr1', { method: 'PATCH', body: JSON.stringify(body) });

describe('/api/card-receipts/[id]', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
    });

    describe('PATCH', () => {
        beforeEach(() => {
            (prisma.cardReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 'cr1' });
            (prisma.cardReceipt.update as jest.Mock).mockResolvedValue({ id: 'cr1' });
        });

        it('parses issueDate to UTC midnight and normalizes the amount', async () => {
            const res = await PATCH(patchReq({ issueDate: '2026-05-17', totalAmount: '12,980' }), ctx('cr1'));
            expect(res.status).toBe(200);
            const data = (prisma.cardReceipt.update as jest.Mock).mock.calls[0][0].data;
            expect(data.issueDate).toEqual(new Date('2026-05-17T00:00:00.000Z'));
            expect(data.totalAmount).toBe(12980);
        });

        it('400 when no editable field is present', async () => {
            const res = await PATCH(patchReq({ unknown: 1 }), ctx('cr1'));
            expect(res.status).toBe(400);
        });

        it('403 without the cashbook access flag', async () => {
            (canAccessCashbook as jest.Mock).mockReturnValueOnce(false);
            const res = await PATCH(patchReq({ storeName: 'A' }), ctx('cr1'));
            expect(res.status).toBe(403);
        });
    });

    describe('DELETE', () => {
        const deleteReq = new NextRequest('http://localhost/api/card-receipts/cr1', { method: 'DELETE' });

        beforeEach(() => {
            (prisma.cardReceipt.count as jest.Mock).mockResolvedValue(0);
            (prisma.cardReceipt.delete as jest.Mock).mockResolvedValue({ id: 'cr1' });
            (prisma.cardStatementLine.update as jest.Mock).mockResolvedValue({});
        });

        it('resets the linked statement line back to unmatched before deleting', async () => {
            (prisma.cardReceipt.findUnique as jest.Mock).mockResolvedValue({
                id: 'cr1',
                storagePath: 'card-receipts/cr1.webp',
                thumbnailPath: 'card-receipts/cr1_thumb.webp',
                statementLine: { id: 'line-1' },
            });
            const res = await DELETE(deleteReq, ctx('cr1'));
            expect(res.status).toBe(200);
            expect(prisma.cardStatementLine.update).toHaveBeenCalledWith({
                where: { id: 'line-1' },
                data: { cardReceiptId: null, status: 'unmatched', matchedAt: null, matchedBy: null },
            });
            expect(prisma.cardReceipt.delete).toHaveBeenCalledWith({ where: { id: 'cr1' } });
            expect(removeMock).toHaveBeenCalledWith(['card-receipts/cr1.webp', 'card-receipts/cr1_thumb.webp']);
        });

        it('keeps the shared storage file when other receipts still reference it', async () => {
            (prisma.cardReceipt.findUnique as jest.Mock).mockResolvedValue({
                id: 'cr1',
                storagePath: 'card-receipts/shared.webp',
                thumbnailPath: null,
                statementLine: null,
            });
            (prisma.cardReceipt.count as jest.Mock).mockResolvedValue(1); // 分割で同じ画像を共有する別レシートあり
            const res = await DELETE(deleteReq, ctx('cr1'));
            expect(res.status).toBe(200);
            expect(prisma.cardStatementLine.update).not.toHaveBeenCalled();
            expect(removeMock).not.toHaveBeenCalled();
        });

        it('404 for a missing receipt', async () => {
            (prisma.cardReceipt.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await DELETE(deleteReq, ctx('cr1'));
            expect(res.status).toBe(404);
        });
    });
});
