/**
 * @jest-environment node
 */
import { GET, PATCH, DELETE } from '@/app/api/billing-drafts/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

const baseDraft = {
    id: 'bd-1',
    projectId: 'pm-1',
    customerId: 'c-1',
    title: '○○邸 着手金',
    amount: '100000',
    taxRate: '0.10',
    status: 'pending' as const,
    invoiceId: null,
    createdById: 'user-1',
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
};

describe('/api/billing-drafts/[id]', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('returns a billing draft', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue(baseDraft);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1');
            const res = await GET(req, { params: { id: 'bd-1' } });

            expect(res.status).toBe(200);
            expect(prisma.billingDraft.findUnique).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'bd-1' },
            }));
        });

        it('returns 404 when not found', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue(null);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-x');
            const res = await GET(req, { params: { id: 'bd-x' } });
            expect(res.status).toBe(404);
        });
    });

    describe('PATCH', () => {
        it('updates a pending billing draft', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue(baseDraft);
            (prisma.billingDraft.update as jest.Mock).mockResolvedValue({ ...baseDraft, amount: '120000' });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', {
                method: 'PATCH',
                body: JSON.stringify({ amount: '120000', note: '値上げ調整' }),
            });
            const res = await PATCH(req, { params: { id: 'bd-1' } });

            expect(res.status).toBe(200);
            expect(prisma.billingDraft.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'bd-1' },
                data: expect.objectContaining({ amount: '120000', note: '値上げ調整' }),
            }));
        });

        it('persists items as JSON and derives amount when items provided', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue(baseDraft);
            (prisma.billingDraft.update as jest.Mock).mockResolvedValue({ ...baseDraft });

            const body = {
                items: [
                    { description: '外部足場組立・解体', quantity: 1, unit: '式', unitPrice: 40000, amount: 40000, taxType: 'standard' },
                    { description: '運搬費', quantity: 1, unit: '式', unitPrice: 30000, amount: 30000, taxType: 'standard' },
                ],
            };
            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', {
                method: 'PATCH',
                body: JSON.stringify(body),
            });
            const res = await PATCH(req, { params: { id: 'bd-1' } });

            expect(res.status).toBe(200);
            const call = (prisma.billingDraft.update as jest.Mock).mock.calls[0][0];
            expect(call.data.amount).toBe('70000');
            expect(JSON.parse(call.data.items)).toHaveLength(2);
        });

        it('rejects PATCH when status=confirmed', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue({ ...baseDraft, status: 'confirmed' });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', {
                method: 'PATCH',
                body: JSON.stringify({ amount: '120000' }),
            });
            const res = await PATCH(req, { params: { id: 'bd-1' } });

            expect(res.status).toBe(400);
            expect(prisma.billingDraft.update).not.toHaveBeenCalled();
        });

        it('rejects PATCH when deletedAt is set', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue({ ...baseDraft, deletedAt: new Date() });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', {
                method: 'PATCH',
                body: JSON.stringify({ amount: '120000' }),
            });
            const res = await PATCH(req, { params: { id: 'bd-1' } });

            expect(res.status).toBe(400);
            expect(prisma.billingDraft.update).not.toHaveBeenCalled();
        });

        it('returns 404 when not found', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue(null);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-x', {
                method: 'PATCH',
                body: JSON.stringify({ amount: '1' }),
            });
            const res = await PATCH(req, { params: { id: 'bd-x' } });
            expect(res.status).toBe(404);
        });

        it('returns 400 when title is empty string', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue(baseDraft);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', {
                method: 'PATCH',
                body: JSON.stringify({ title: '' }),
            });
            const res = await PATCH(req, { params: { id: 'bd-1' } });
            expect(res.status).toBe(400);
        });
    });

    describe('DELETE', () => {
        it('logically deletes a pending billing draft', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue(baseDraft);
            (prisma.billingDraft.update as jest.Mock).mockResolvedValue({ ...baseDraft, deletedAt: new Date() });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', { method: 'DELETE' });
            const res = await DELETE(req, { params: { id: 'bd-1' } });

            expect(res.status).toBe(200);
            expect(prisma.billingDraft.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'bd-1' },
                data: expect.objectContaining({ deletedAt: expect.any(Date) }),
            }));
            // 物理削除はしない
            expect(prisma.billingDraft.delete).not.toHaveBeenCalled();
        });

        it('rejects DELETE when status=confirmed', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue({ ...baseDraft, status: 'confirmed' });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', { method: 'DELETE' });
            const res = await DELETE(req, { params: { id: 'bd-1' } });

            expect(res.status).toBe(400);
            expect(prisma.billingDraft.update).not.toHaveBeenCalled();
        });

        it('rejects DELETE when already deleted', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue({ ...baseDraft, deletedAt: new Date() });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', { method: 'DELETE' });
            const res = await DELETE(req, { params: { id: 'bd-1' } });

            expect(res.status).toBe(400);
            expect(prisma.billingDraft.update).not.toHaveBeenCalled();
        });

        it('returns 404 when not found', async () => {
            (prisma.billingDraft.findUnique as jest.Mock).mockResolvedValue(null);

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-x', { method: 'DELETE' });
            const res = await DELETE(req, { params: { id: 'bd-x' } });
            expect(res.status).toBe(404);
        });

        it('returns 403 when not authorized', async () => {
            const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });

            const req = new NextRequest('http://localhost:3000/api/billing-drafts/bd-1', { method: 'DELETE' });
            const res = await DELETE(req, { params: { id: 'bd-1' } });
            expect(res.status).toBe(403);
        });
    });
});
