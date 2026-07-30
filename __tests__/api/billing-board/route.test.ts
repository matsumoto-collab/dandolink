/**
 * @jest-environment node
 */
import { GET } from '@/app/api/billing-board/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAccountant } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 案件×締め月の請求判断が、表示中の基準月(periodKey)で解決されることを検証する。
 * 末締め(closingDay:0)の顧客 c-1 に属する案件 pm-1 が 2026-06-10 に配置を持つ前提。
 */
describe('GET /api/billing-board（案件×締め月の請求判断の解決）', () => {
    const mockSession = { user: { id: 'user-1', role: 'manager', isActive: true } };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAccountant as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (prisma.customer.findMany as jest.Mock).mockResolvedValue([{ id: 'c-1', closingDay: 0 }]);
        (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
            {
                id: 'pm-1',
                title: 'A社 現場',
                name: 'A現場',
                customerId: 'c-1',
                customerName: 'A社',
                status: 'active',
                contractAmount: 100000,
                billingEstimateIds: null,
                createdBy: null,
            },
        ]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([
            {
                projectMasterId: 'pm-1',
                date: new Date('2026-06-10T00:00:00+09:00'),
                constructionType: null,
                assignedEmployeeId: 'f-1',
                memberCount: 2,
            },
        ]);
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.billingDraft.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.projectBillingDecision.findMany as jest.Mock).mockResolvedValue([
            { projectMasterId: 'pm-1', decision: 'hold' },
        ]);
    });

    it('締め分モードは当月(periodKey)の判断を解決して返す', async () => {
        const req = new NextRequest('http://localhost:3000/api/billing-board?month=2026-06');
        const res = await GET(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toHaveLength(1);
        expect(json[0].billingDecision).toBe('hold');
        // periodKey は基準月（顧客の締め日に依らず "YYYY-MM"）
        expect(prisma.projectBillingDecision.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ periodKey: '2026-06' }) }),
        );
    });

    it('任意範囲モードは判断を引かず pending 固定で返す', async () => {
        const req = new NextRequest('http://localhost:3000/api/billing-board?from=2026-06-01&to=2026-06-30');
        const res = await GET(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toHaveLength(1);
        expect(json[0].billingDecision).toBe('pending');
        expect(prisma.projectBillingDecision.findMany).not.toHaveBeenCalled();
    });

    it('その締め月に発行された請求書はその月の請求実績(monthlyInvoicedAmount)に計上し、別月は除外する', async () => {
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
            {
                status: 'sent',
                subtotal: 80000,
                items: JSON.stringify([{ projectMasterId: 'pm-1', amount: 80000 }]),
                projectMasterId: 'pm-1',
                createdAt: new Date('2026-06-30T00:00:00+09:00'), // 6月締め期間内
            },
            {
                status: 'sent',
                subtotal: 50000,
                items: JSON.stringify([{ projectMasterId: 'pm-1', amount: 50000 }]),
                projectMasterId: 'pm-1',
                createdAt: new Date('2026-05-15T00:00:00+09:00'), // 別月（5月）＝当月の実績に含めない
            },
        ]);
        const req = new NextRequest('http://localhost:3000/api/billing-board?month=2026-06');
        const res = await GET(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json[0].monthlyInvoicedAmount).toBe(80000); // その月に発行した請求のみ
        expect(json[0].invoicedAmount).toBe(130000); // 案件トータル（全期間）は別途そのまま
    });

    /**
     * 見積金額は「金額スナップショット(contractAmount)」ではなく見積書の現在値(subtotal)から解決する。
     * 優先順: billingEstimateIds → 見積1件 → 見積複数(contractAmount互換) → 見積0件(contractAmount)。
     */
    describe('見積金額(estimateAmount)の解決', () => {
        /** 案件 pm-1 の contractAmount と billingEstimateIds を差し替える。 */
        function setProject(contractAmount: number | null, billingEstimateIds: unknown = null) {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
                {
                    id: 'pm-1',
                    title: 'A社 現場',
                    name: 'A現場',
                    customerId: 'c-1',
                    customerName: 'A社',
                    status: 'active',
                    contractAmount,
                    billingEstimateIds,
                    createdBy: null,
                },
            ]);
        }

        async function fetchRow() {
            const res = await GET(new NextRequest('http://localhost:3000/api/billing-board?month=2026-06'));
            expect(res.status).toBe(200);
            return (await res.json())[0];
        }

        it('billingEstimateIds があれば、その見積の subtotal 合算（ライブ値）を使う', async () => {
            setProject(100000, ['e-1', 'e-3']);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
                { id: 'e-1', projectMasterId: 'pm-1', status: 'approved', subtotal: 300000 },
                { id: 'e-2', projectMasterId: 'pm-1', status: 'draft', subtotal: 999999 },
                { id: 'e-3', projectMasterId: 'pm-1', status: 'draft', subtotal: 20000 },
            ]);
            const row = await fetchRow();
            expect(row.estimateAmount).toBe(320000); // contractAmount(100000) には引きずられない
            expect(row.needsEstimatePick).toBe(false);
        });

        it('billingEstimateIds の見積が全て存在しなければ未選択扱いでフォールバックする', async () => {
            setProject(100000, ['deleted-1']);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
                { id: 'e-1', projectMasterId: 'pm-1', status: 'approved', subtotal: 300000 },
            ]);
            const row = await fetchRow();
            expect(row.estimateAmount).toBe(300000); // 見積1件のライブ値へ
        });

        it('見積1件なら contractAmount より見積の現在値を優先する（見積修正への追従）', async () => {
            setProject(100000, null);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
                { id: 'e-1', projectMasterId: 'pm-1', status: 'approved', subtotal: 250000 },
            ]);
            const row = await fetchRow();
            expect(row.estimateAmount).toBe(250000);
            expect(row.needsEstimatePick).toBe(false);
        });

        it('見積が複数で未選択なら contractAmount を使う（旧スナップショット互換）', async () => {
            setProject(100000, null);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
                { id: 'e-1', projectMasterId: 'pm-1', status: 'draft', subtotal: 250000 },
                { id: 'e-2', projectMasterId: 'pm-1', status: 'draft', subtotal: 70000 },
            ]);
            const row = await fetchRow();
            expect(row.estimateAmount).toBe(100000);
            expect(row.needsEstimatePick).toBe(false);
        });

        it('見積が複数で contractAmount も無ければ「見積を選択」を促す', async () => {
            setProject(null, null);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
                { id: 'e-1', projectMasterId: 'pm-1', status: 'draft', subtotal: 250000 },
                { id: 'e-2', projectMasterId: 'pm-1', status: 'draft', subtotal: 70000 },
            ]);
            const row = await fetchRow();
            expect(row.estimateAmount).toBeNull();
            expect(row.needsEstimatePick).toBe(true);
        });

        it('見積が0件なら contractAmount（手入力）を使う', async () => {
            setProject(100000, null);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
            const row = await fetchRow();
            expect(row.estimateAmount).toBe(100000);
            expect(row.needsEstimatePick).toBe(false);
        });
    });

    it('未認可なら 403', async () => {
        const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
        (requireManagerOrAccountant as jest.Mock).mockResolvedValue({ session: null, error: errorRes });
        const req = new NextRequest('http://localhost:3000/api/billing-board?month=2026-06');
        const res = await GET(req);
        expect(res.status).toBe(403);
    });
});
