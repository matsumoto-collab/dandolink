/**
 * @jest-environment node
 */
import { PATCH, DELETE } from '@/app/api/card-statement-lines/[id]/route';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/api/utils';
import { canAccessCashbook } from '@/utils/permissions';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase-admin', () => ({
    supabaseAdmin: { storage: { from: () => ({}) } },
    STORAGE_BUCKET: 'project-master-files',
}));

const mockSession = { user: { id: 'user-1', role: 'admin', isActive: true, canAccessCashbook: true } };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (body: unknown) =>
    new NextRequest('http://localhost/api/card-statement-lines/l1', { method: 'PATCH', body: JSON.stringify(body) });

const baseLine = { id: 'l1', status: 'unmatched', cardReceiptId: null, expenseCategoryId: null };

describe('/api/card-statement-lines/[id] PATCH', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
        (prisma.cardStatementLine.findUnique as jest.Mock).mockResolvedValue(baseLine);
        (prisma.cardStatementLine.update as jest.Mock).mockResolvedValue({ id: 'l1' });
    });

    it('links a receipt: sets matched status and inherits the receipt category when the line has none', async () => {
        (prisma.cardReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 'cr1', expenseCategoryId: 'cat-1' });
        const res = await PATCH(patchReq({ cardReceiptId: 'cr1' }), ctx('l1'));
        expect(res.status).toBe(200);
        const data = (prisma.cardStatementLine.update as jest.Mock).mock.calls[0][0].data;
        expect(data.cardReceiptId).toBe('cr1');
        expect(data.status).toBe('matched');
        expect(data.matchedBy).toBe('user-1');
        expect(data.expenseCategoryId).toBe('cat-1');
    });

    it('does not overwrite an already-assigned line category on link', async () => {
        (prisma.cardStatementLine.findUnique as jest.Mock).mockResolvedValue({ ...baseLine, expenseCategoryId: 'cat-line' });
        (prisma.cardReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 'cr1', expenseCategoryId: 'cat-receipt' });
        await PATCH(patchReq({ cardReceiptId: 'cr1' }), ctx('l1'));
        const data = (prisma.cardStatementLine.update as jest.Mock).mock.calls[0][0].data;
        expect(data.expenseCategoryId).toBeUndefined();
    });

    it('returns 400 with a friendly message when the receipt is already linked elsewhere (P2002)', async () => {
        (prisma.cardReceipt.findUnique as jest.Mock).mockResolvedValue({ id: 'cr1', expenseCategoryId: null });
        (prisma.cardStatementLine.update as jest.Mock).mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
        );
        const res = await PATCH(patchReq({ cardReceiptId: 'cr1' }), ctx('l1'));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('紐付け済み');
    });

    it('unlinks with cardReceiptId: null and resets the status to unmatched', async () => {
        const res = await PATCH(patchReq({ cardReceiptId: null }), ctx('l1'));
        expect(res.status).toBe(200);
        const data = (prisma.cardStatementLine.update as jest.Mock).mock.calls[0][0].data;
        expect(data).toMatchObject({ cardReceiptId: null, status: 'unmatched', matchedAt: null, matchedBy: null });
    });

    it('rejects a direct status change on a matched line (must unlink first)', async () => {
        (prisma.cardStatementLine.findUnique as jest.Mock).mockResolvedValue({ ...baseLine, status: 'matched', cardReceiptId: 'cr1' });
        const res = await PATCH(patchReq({ status: 'no_receipt' }), ctx('l1'));
        expect(res.status).toBe(400);
    });

    it('marks an unmatched line as no_receipt', async () => {
        const res = await PATCH(patchReq({ status: 'no_receipt' }), ctx('l1'));
        expect(res.status).toBe(200);
        expect((prisma.cardStatementLine.update as jest.Mock).mock.calls[0][0].data.status).toBe('no_receipt');
    });

    it('rejects unknown statuses', async () => {
        const res = await PATCH(patchReq({ status: 'matched' }), ctx('l1'));
        expect(res.status).toBe(400);
    });

    it('accepts negative amounts for refund lines', async () => {
        const res = await PATCH(patchReq({ amount: '-3,000' }), ctx('l1'));
        expect(res.status).toBe(200);
        expect((prisma.cardStatementLine.update as jest.Mock).mock.calls[0][0].data.amount).toBe(-3000);
    });

    it('403 without the cashbook access flag', async () => {
        (canAccessCashbook as jest.Mock).mockReturnValueOnce(false);
        const res = await PATCH(patchReq({ status: 'no_receipt' }), ctx('l1'));
        expect(res.status).toBe(403);
    });
});

describe('/api/card-statement-lines/[id] DELETE', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canAccessCashbook as jest.Mock).mockReturnValue(true);
    });

    it('deletes the line', async () => {
        (prisma.cardStatementLine.findUnique as jest.Mock).mockResolvedValue(baseLine);
        (prisma.cardStatementLine.delete as jest.Mock).mockResolvedValue(baseLine);
        const res = await DELETE(new NextRequest('http://localhost/api/card-statement-lines/l1', { method: 'DELETE' }), ctx('l1'));
        expect(res.status).toBe(200);
        expect(prisma.cardStatementLine.delete).toHaveBeenCalledWith({ where: { id: 'l1' } });
    });

    it('404 for a missing line', async () => {
        (prisma.cardStatementLine.findUnique as jest.Mock).mockResolvedValue(null);
        const res = await DELETE(new NextRequest('http://localhost/api/card-statement-lines/l1', { method: 'DELETE' }), ctx('l1'));
        expect(res.status).toBe(404);
    });
});
