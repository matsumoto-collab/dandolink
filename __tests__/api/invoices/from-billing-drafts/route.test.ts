/**
 * @jest-environment node
 */
import { POST } from '@/app/api/invoices/from-billing-drafts/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { createInvoiceVersion } from '@/lib/versions/snapshot';
import { NextRequest, NextResponse } from 'next/server';

const YEAR = new Date().getFullYear();

function draft(over: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'bd-1',
        projectId: 'pm-1',
        customerId: 'c-1',
        title: '○○邸 着手金',
        amount: '100000',
        taxRate: '0.10',
        status: 'pending',
        invoiceId: null,
        createdById: 'user-1',
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...over,
    };
}

function createdInvoice(over: Partial<Record<string, unknown>> = {}) {
    return {
        id: 'inv-1',
        invoiceNumber: `I${YEAR}0001`,
        title: '御請求',
        items: '[]',
        subtotal: 0,
        tax: 0,
        total: 0,
        dueDate: new Date(),
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
    };
}

function post(body: unknown) {
    return POST(
        new NextRequest('http://localhost:3000/api/invoices/from-billing-drafts', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
    );
}

describe('POST /api/invoices/from-billing-drafts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({
            session: { user: { id: 'user-1', role: 'manager', isActive: true } },
            error: null,
        });
        (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.invoice.create as jest.Mock).mockResolvedValue(createdInvoice());
        (prisma.billingDraft.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    });

    it('issues an invoice from client-provided items and confirms the drafts', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([
            draft({ id: 'bd-1', amount: '100000' }),
            draft({ id: 'bd-2', amount: '200000', title: '○○邸 完了金' }),
        ]);

        const res = await post({
            billingDraftIds: ['bd-1', 'bd-2'],
            title: '御請求',
            items: [
                { id: 'bd-1', description: '着手金', quantity: 1, unit: '式', unitPrice: 100000, amount: 100000, taxType: 'standard', projectMasterId: 'pm-1' },
                { id: 'bd-2', description: '完了金', quantity: 1, unit: '式', unitPrice: 200000, amount: 200000, taxType: 'standard', projectMasterId: 'pm-1' },
            ],
        });

        expect(res.status).toBe(200);

        // subtotal/tax/total はサーバー算出（floor(300000*0.1)=30000）
        expect(prisma.invoice.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    invoiceNumber: `I${YEAR}0001`,
                    customerId: 'c-1',
                    projectMasterId: 'pm-1',
                    subtotal: 300000,
                    tax: 30000,
                    total: 330000,
                    status: 'draft',
                }),
            }),
        );
        // 対象 draft を confirmed + invoiceId 紐づけ
        expect(prisma.billingDraft.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['bd-1', 'bd-2'] } },
            data: { status: 'confirmed', invoiceId: 'inv-1' },
        });
        // バージョンスナップショット
        expect(createInvoiceVersion).toHaveBeenCalled();
    });

    it('computes tax only on standard items (mixed tax types)', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([draft({ id: 'bd-1' })]);

        await post({
            billingDraftIds: ['bd-1'],
            title: '御請求',
            items: [
                { id: 'a', description: '課税', quantity: 1, unit: '式', unitPrice: 100000, amount: 100000, taxType: 'standard', projectMasterId: 'pm-1' },
                { id: 'b', description: '非課税', quantity: 1, unit: '式', unitPrice: 50000, amount: 50000, taxType: 'none', projectMasterId: 'pm-1' },
            ],
        });

        expect(prisma.invoice.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ subtotal: 150000, tax: 10000, total: 160000 }),
            }),
        );
    });

    it('dedups projectMasterId into one InvoiceProjectMaster row per project', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([
            draft({ id: 'bd-1', projectId: 'pm-1' }),
            draft({ id: 'bd-2', projectId: 'pm-1' }),
            draft({ id: 'bd-3', projectId: 'pm-2' }),
        ]);

        await post({ billingDraftIds: ['bd-1', 'bd-2', 'bd-3'], title: '御請求' });

        const call = (prisma.invoiceProjectMaster.createMany as jest.Mock).mock.calls[0][0];
        expect(call.data).toEqual([
            { invoiceId: 'inv-1', projectMasterId: 'pm-1', sortOrder: 0 },
            { invoiceId: 'inv-1', projectMasterId: 'pm-2', sortOrder: 1 },
        ]);
    });

    it('excludes null-amount drafts when items are not provided (D-f default)', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([
            draft({ id: 'bd-1', amount: '100000', projectId: 'pm-1' }),
            draft({ id: 'bd-2', amount: null, projectId: 'pm-2' }),
        ]);

        await post({ billingDraftIds: ['bd-1', 'bd-2'], title: '御請求' });

        // 確定対象は金額入りの bd-1 のみ
        expect(prisma.billingDraft.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['bd-1'] } },
            data: { status: 'confirmed', invoiceId: 'inv-1' },
        });
        // IPM も bd-1 の案件のみ
        const ipmCall = (prisma.invoiceProjectMaster.createMany as jest.Mock).mock.calls[0][0];
        expect(ipmCall.data).toEqual([{ invoiceId: 'inv-1', projectMasterId: 'pm-1', sortOrder: 0 }]);
    });

    it('returns 400 when drafts belong to different customers', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([
            draft({ id: 'bd-1', customerId: 'c-1' }),
            draft({ id: 'bd-2', customerId: 'c-2' }),
        ]);

        const res = await post({ billingDraftIds: ['bd-1', 'bd-2'], title: '御請求' });
        expect(res.status).toBe(400);
        expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('returns 400 when a non-pending draft is included', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([
            draft({ id: 'bd-1', status: 'pending' }),
            draft({ id: 'bd-2', status: 'confirmed' }),
        ]);

        const res = await post({ billingDraftIds: ['bd-1', 'bd-2'], title: '御請求' });
        expect(res.status).toBe(400);
        expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('returns 400 when a deleted draft is included', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([
            draft({ id: 'bd-1', deletedAt: new Date() }),
        ]);

        const res = await post({ billingDraftIds: ['bd-1'], title: '御請求' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when some draft ids are not found', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([draft({ id: 'bd-1' })]);

        const res = await post({ billingDraftIds: ['bd-1', 'bd-missing'], title: '御請求' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when title is empty', async () => {
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([draft()]);
        const res = await post({ billingDraftIds: ['bd-1'], title: '' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when billingDraftIds is empty', async () => {
        const res = await post({ billingDraftIds: [], title: '御請求' });
        expect(res.status).toBe(400);
    });

    it('returns 403 when not authorized', async () => {
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({
            session: null,
            error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
        });

        const res = await post({ billingDraftIds: ['bd-1'], title: '御請求' });
        expect(res.status).toBe(403);
    });
});
