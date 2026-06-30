/**
 * @jest-environment node
 */
import { GET } from '@/app/api/billing-board/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 案件×締め月の請求判断が、表示中の基準月(periodKey)で解決されることを検証する。
 * 末締め(closingDay:0)の顧客 c-1 に属する案件 pm-1 が 2026-06-10 に配置を持つ前提。
 */
describe('GET /api/billing-board（案件×締め月の請求判断の解決）', () => {
    const mockSession = { user: { id: 'user-1', role: 'manager', isActive: true } };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
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

    it('未認可なら 403', async () => {
        const errorRes = NextResponse.json({ error: 'forbidden' }, { status: 403 });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });
        const req = new NextRequest('http://localhost:3000/api/billing-board?month=2026-06');
        const res = await GET(req);
        expect(res.status).toBe(403);
    });
});
