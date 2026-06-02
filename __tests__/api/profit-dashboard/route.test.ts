/**
 * @jest-environment node
 */
import { GET } from '@/app/api/profit-dashboard/route';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { fetchProfitDashboardData, fetchDashboardFilterOptions, fetchMonthlySales } from '@/lib/profitDashboard';
import { NextRequest, NextResponse } from 'next/server';

jest.mock('@/lib/api/utils', () => ({
    requireManagerOrAbove: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: String(error) }, { status: 500 })),
}));

// ルートは薄いラッパ。集計ロジックは lib 側で単体検証済みなのでモックする。
jest.mock('@/lib/profitDashboard', () => ({
    fetchProfitDashboardData: jest.fn(),
    fetchDashboardFilterOptions: jest.fn(),
    fetchMonthlySales: jest.fn(),
}));

describe('/api/profit-dashboard GET', () => {
    const req = (qs = '') => new NextRequest(`http://localhost/api/profit-dashboard?${qs}`);

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'manager' } }, error: null });
    });

    it('権限が無ければそのエラーを返し、集計は呼ばない', async () => {
        const err = NextResponse.json({ error: '権限がありません' }, { status: 403 });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

        const res = await GET(req('status=all'));
        expect(res.status).toBe(403);
        expect(fetchProfitDashboardData).not.toHaveBeenCalled();
    });

    it('options=1 でフィルタ選択肢を返す', async () => {
        (fetchDashboardFilterOptions as jest.Mock).mockResolvedValue({ customers: ['A'], foremen: [], constructionTypes: [] });

        const res = await GET(req('options=1'));
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.customers).toEqual(['A']);
        expect(fetchDashboardFilterOptions).toHaveBeenCalled();
    });

    it('案件データ・サマリ・今月の売上を返す', async () => {
        (fetchProfitDashboardData as jest.Mock).mockResolvedValue({
            projects: [{ id: 'p1', updatedAt: new Date() }],
            summary: { totalProjects: 1, totalRevenue: 100, totalCost: 60, totalGrossProfit: 40, averageProfitMargin: 40 },
            byCustomer: [], byConstructionType: [], byForeman: [],
        });
        (fetchMonthlySales as jest.Mock).mockResolvedValue({
            current: { year: 2026, month: 6, sales: 0, invoiceCount: 0 },
            previous: { year: 2026, month: 5, sales: 0, invoiceCount: 0 },
            momDelta: 0, momPercent: null, trend: [],
        });

        const res = await GET(req('status=active'));
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.projects).toHaveLength(1);
        expect(json.summary.totalProjects).toBe(1);
        expect(json.monthlySales).toBeDefined();
        expect(fetchProfitDashboardData).toHaveBeenCalled();
        expect(fetchMonthlySales).toHaveBeenCalled();
    });
});
