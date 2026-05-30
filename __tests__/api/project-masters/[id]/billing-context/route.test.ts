/**
 * @jest-environment node
 */
import { GET } from '@/app/api/project-masters/[id]/billing-context/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

describe('GET /api/project-masters/[id]/billing-context', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };

    const PM_ID = 'pm-1';

    const buildReq = () =>
        new NextRequest(`http://localhost:3000/api/project-masters/${PM_ID}/billing-context`);

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        // 既定の戻り値（空）
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.invoiceProjectMaster.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('returns 403 when not authorized', async () => {
        const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        expect(res.status).toBe(403);
    });

    it('returns 404 when project master is not found', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(null);

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        expect(res.status).toBe(404);
    });

    it('returns empty defaults when project has no invoices / estimates / drafts', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: PM_ID, contractAmount: null });

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual({
            contractAmount: null,
            totalInvoicedAmount: 0,
            estimates: { items: [], totalCount: 0 },
            history: [],
        });
    });

    it('returns contractAmount when project has one set', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: PM_ID, contractAmount: 1_500_000 });

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        const json = await res.json();

        expect(json.contractAmount).toBe(1_500_000);
    });

    it('totalInvoicedAmount はこの案件ぶんの明細按分で算出する（請求書合計ではない）・dedup', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: PM_ID, contractAmount: 0 });

        // 各請求書に「この案件ぶん」と「別案件ぶん」の明細を混在させ、按分されることを検証
        const itemsFor = (forThis: number, forOther: number) =>
            JSON.stringify([
                { projectMasterId: PM_ID, amount: forThis },
                { projectMasterId: 'pm-other', amount: forOther },
            ]);

        const directInvoices = [
            { id: 'inv-A', invoiceNumber: 'I001', title: '直接1', total: 110_000, subtotal: 100_000, projectMasterId: PM_ID, items: itemsFor(80_000, 20_000), status: 'sent', createdAt: new Date('2026-01-01') },
            { id: 'inv-B', invoiceNumber: 'I002', title: '直接2', total: 55_000, subtotal: 50_000, projectMasterId: PM_ID, items: itemsFor(50_000, 0), status: 'draft', createdAt: new Date('2026-01-02') },
        ];
        const linkedInvoices = [
            // inv-B は direct と重複（dedup される）
            { id: 'inv-B', invoiceNumber: 'I002', title: '直接2', total: 55_000, subtotal: 50_000, projectMasterId: PM_ID, items: itemsFor(50_000, 0), status: 'draft', createdAt: new Date('2026-01-02') },
            { id: 'inv-C', invoiceNumber: 'I003', title: 'N:N経由', total: 220_000, subtotal: 200_000, projectMasterId: 'pm-other', items: itemsFor(120_000, 80_000), status: 'paid', createdAt: new Date('2026-01-03') },
        ];

        (prisma.invoice.findMany as jest.Mock)
            .mockResolvedValueOnce(directInvoices)   // 1 回目：directInvoices クエリ
            .mockResolvedValueOnce(linkedInvoices);  // 2 回目：linked id IN クエリ
        (prisma.invoiceProjectMaster.findMany as jest.Mock).mockResolvedValue([
            { invoiceId: 'inv-B' },
            { invoiceId: 'inv-C' },
        ]);

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        const json = await res.json();

        // この案件ぶん: 80,000 + 50,000 + 120,000 = 250,000
        // （請求書合計の 110k+55k+220k=385k ではない。inv-B は dedup されて 1 回のみ）
        expect(json.totalInvoicedAmount).toBe(250_000);
    });

    it('明細に projectMasterId タグが無いレガシー Invoice は代表案件のとき subtotal を計上', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: PM_ID, contractAmount: 0 });

        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
            { id: 'inv-legacy', invoiceNumber: 'I900', title: '旧', total: 99_000, subtotal: 90_000, projectMasterId: PM_ID, items: '[]', status: 'sent', createdAt: new Date('2026-01-01') },
        ]);

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        const json = await res.json();

        // 無タグ → 代表案件(PM_ID)に税抜 subtotal を計上（total 99,000 ではない）
        expect(json.totalInvoicedAmount).toBe(90_000);
    });

    it('excludes cancelled invoices from totalInvoicedAmount', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: PM_ID, contractAmount: 0 });

        const items = (amt: number) => JSON.stringify([{ projectMasterId: PM_ID, amount: amt }]);
        const invoices = [
            { id: 'inv-A', invoiceNumber: 'I001', title: '送付済', total: 110_000, subtotal: 100_000, projectMasterId: PM_ID, items: items(100_000), status: 'sent', createdAt: new Date('2026-01-01') },
            { id: 'inv-B', invoiceNumber: 'I002', title: 'キャンセル', total: 999_999, subtotal: 900_000, projectMasterId: PM_ID, items: items(900_000), status: 'cancelled', createdAt: new Date('2026-01-02') },
            { id: 'inv-C', invoiceNumber: 'I003', title: '支払済', total: 55_000, subtotal: 50_000, projectMasterId: PM_ID, items: items(50_000), status: 'paid', createdAt: new Date('2026-01-03') },
        ];
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue(invoices);

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        const json = await res.json();

        // cancelled は除外、案件ぶん 100,000 + 50,000 = 150,000
        expect(json.totalInvoicedAmount).toBe(150_000);
    });

    it('orders estimates with approved first, then createdAt desc, with totalCount and 3-item cap', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: PM_ID, contractAmount: 0 });

        // subtotal(税別) を total と別値にして、税別が返ることも検証する
        const estimates = [
            { id: 'e-1', estimateNumber: 'E001', title: '古い approved', status: 'approved', total: 110, subtotal: 100, createdAt: new Date('2026-01-01'), createdByName: 'A' },
            { id: 'e-2', estimateNumber: 'E002', title: '新しい draft', status: 'draft', total: 220, subtotal: 200, createdAt: new Date('2026-03-01'), createdByName: 'B' },
            { id: 'e-3', estimateNumber: 'E003', title: '新しい approved', status: 'approved', total: 330, subtotal: 300, createdAt: new Date('2026-02-01'), createdByName: 'C' },
            { id: 'e-4', estimateNumber: 'E004', title: '中間 sent', status: 'sent', total: 440, subtotal: 400, createdAt: new Date('2026-02-15'), createdByName: 'D' },
            { id: 'e-5', estimateNumber: 'E005', title: '古い rejected', status: 'rejected', total: 550, subtotal: 500, createdAt: new Date('2025-12-01'), createdByName: 'E' },
        ];
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue(estimates);

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        const json = await res.json();

        // approved 2 件（新→古）→ draft / sent / rejected が createdAt desc
        // 期待順序: e-3 (approved, 2026-02-01), e-1 (approved, 2026-01-01), e-2 (draft, 2026-03-01)
        expect(json.estimates.totalCount).toBe(5);
        expect(json.estimates.items).toHaveLength(3);
        expect(json.estimates.items[0].id).toBe('e-3');
        expect(json.estimates.items[1].id).toBe('e-1');
        expect(json.estimates.items[2].id).toBe('e-2');
        // 金額は税別(subtotal)で返る（total 330 ではなく subtotal 300）
        expect(json.estimates.items[0].subtotal).toBe(300);
        expect(json.estimates.items[0]).not.toHaveProperty('total');
    });

    it('merges history (BillingDraft + Invoice) sorted by createdAt desc', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: PM_ID, contractAmount: 0 });

        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
            // total 100 だが、この案件ぶんは 70（pm-other ぶん 30 は含めない）
            { id: 'inv-A', invoiceNumber: 'I001', title: '請求書1', total: 110, subtotal: 100, projectMasterId: PM_ID, items: JSON.stringify([{ projectMasterId: PM_ID, amount: 70 }, { projectMasterId: 'pm-other', amount: 30 }]), status: 'sent', createdAt: new Date('2026-02-01') },
        ]);
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([
            { id: 'bd-A', title: '予定1', amount: '500', status: 'pending', createdAt: new Date('2026-03-01') },
            { id: 'bd-B', title: '予定2', amount: null, status: 'cancelled', createdAt: new Date('2026-01-01') },
        ]);

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        const json = await res.json();

        // createdAt desc: bd-A (3/1) → inv-A (2/1) → bd-B (1/1)
        expect(json.history).toHaveLength(3);
        expect(json.history[0]).toEqual(expect.objectContaining({ type: 'billing-draft', id: 'bd-A', amount: 500 }));
        // 請求書は total(100) ではなく案件ぶん按分の 70
        expect(json.history[1]).toEqual(expect.objectContaining({ type: 'invoice', id: 'inv-A', invoiceNumber: 'I001', amount: 70 }));
        expect(json.history[2]).toEqual(expect.objectContaining({ type: 'billing-draft', id: 'bd-B', amount: null }));
    });

    it('filters out soft-deleted billing drafts via deletedAt query', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: PM_ID, contractAmount: 0 });

        const res = await GET(buildReq(), { params: { id: PM_ID } });
        expect(res.status).toBe(200);

        // billingDraft.findMany が deletedAt: null + projectId フィルタで呼ばれること
        expect(prisma.billingDraft.findMany).toHaveBeenCalledWith({
            where: { projectId: PM_ID, deletedAt: null },
        });
    });
});
