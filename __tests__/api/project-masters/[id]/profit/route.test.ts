/**
 * @jest-environment node
 */
import { GET } from '@/app/api/project-masters/[id]/profit/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { computeProjectCosts } from '@/lib/projectCost';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectMaster: { findUnique: jest.fn() },
        estimate: { findMany: jest.fn() },
        invoice: { findMany: jest.fn() },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: String(error) }, { status: 500 })),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
}));

// 原価エンジンは projectCost.test.ts で検証済み。ここでは結果をモックして売上・レスポンス形に集中する。
jest.mock('@/lib/projectCost', () => ({ computeProjectCosts: jest.fn() }));

const breakdown = (over: Partial<Record<string, number>> = {}) => ({
    laborCost: 0, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: 0, ...over,
});
const costResult = (b: ReturnType<typeof breakdown>) => new Map([['proj-1', {
    breakdown: b,
    detail: { labor: [], vehicle: [], subcontractor: [], materialCost: b.materialCost, otherExpenses: b.otherExpenses, loadingCost: b.loadingCost },
}]]);

describe('/api/project-masters/[id]/profit', () => {
    const mockSession = { user: { id: 'user-1', role: 'admin' } };
    const mockId = 'proj-1';
    const context = { params: Promise.resolve({ id: mockId }) };
    const createReq = () => new NextRequest(`http://localhost:3000/api/project-masters/${mockId}/profit`);

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(costResult(breakdown()));
    });

    it('売上(請求 税抜フォールバック)と computeProjectCosts の原価から粗利を出す', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: mockId, title: 'A', contractAmount: 0, revenueOverride: null });
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([{ total: 100000, subtotal: 90909, costTotal: null }]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([{ total: 120000, subtotal: 109091 }]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(costResult(breakdown({ materialCost: 10000, otherExpenses: 2000, totalCost: 12000 })));

        const res = await GET(createReq(), context);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.revenue).toBe(109091); // 請求の税抜小計を優先
        expect(json.revenueSource).toBe('invoice');
        expect(json.estimateAmount).toBe(100000);
        expect(json.costBreakdown.totalCost).toBe(12000);
        expect(json.grossProfit).toBe(109091 - 12000);
        expect(computeProjectCosts).toHaveBeenCalledWith(['proj-1'], { withDetail: true });
    });

    it('costBreakdown は computeProjectCosts の結果をそのまま反映する', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: mockId, title: 'A', contractAmount: 0, revenueOverride: null });
        (computeProjectCosts as jest.Mock).mockResolvedValue(costResult(breakdown({ laborCost: 14400, vehicleCost: 5000, totalCost: 19400 })));

        const res = await GET(createReq(), context);
        const json = await res.json();
        expect(json.costBreakdown.laborCost).toBe(14400);
        expect(json.costBreakdown.vehicleCost).toBe(5000);
        expect(json.costBreakdown.totalCost).toBe(19400);
    });

    it('revenueOverride があれば売上に優先採用する', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: mockId, title: 'A', contractAmount: 0, revenueOverride: 500000 });
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([{ total: 120000, subtotal: 109091 }]);

        const res = await GET(createReq(), context);
        const json = await res.json();
        expect(json.revenue).toBe(500000);
        expect(json.revenueSource).toBe('override');
    });

    it('案件が無ければ 404', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(null);
        const res = await GET(createReq(), context);
        expect(res.status).toBe(404);
    });
});
