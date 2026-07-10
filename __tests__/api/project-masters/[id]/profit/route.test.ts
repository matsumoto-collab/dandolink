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
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([{ total: 120000, subtotal: 109091, items: '[]', projectMasterId: mockId }]);
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
        // 請求は送付済み以降＋代表/明細タグの2経路で取得する
        expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                status: { in: ['sent', 'paid', 'overdue'] },
                OR: [{ projectMasterId: mockId }, { items: { contains: mockId } }],
            },
        }));
    });

    it('まとめ請求は明細タグのこの案件ぶんだけ計上する（代表が別案件でも拾う）', async () => {
        // 橋本様邸パターン: 単独請求58,500＋3案件まとめ請求165,000(うちこの案件58,500・代表は別案件)
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: mockId, title: 'A', contractAmount: 0, revenueOverride: null });
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
            { total: 64350, subtotal: 58500, items: `[{"projectMasterId":"${mockId}","amount":58500}]`, projectMasterId: mockId },
            {
                total: 181500, subtotal: 165000, projectMasterId: 'proj-other',
                items: `[{"projectMasterId":"${mockId}","amount":58500},{"projectMasterId":"proj-other","amount":80000},{"projectMasterId":"proj-3","amount":26500}]`,
            },
        ]);

        const json = await (await GET(createReq(), context)).json();

        expect(json.invoiceSubtotal).toBe(117000);  // 58500 + 165000×(58500/165000)
        expect(json.invoiceAmount).toBe(128700);    // 64350 + 181500×(58500/165000)
        expect(json.confirmedRevenue).toBe(117000); // 旧実装の223,500(全額合算)にならない
        expect(json.revenue).toBe(117000);
    });

    it('見込み(見積基準)・確定(請求基準)・見積残・消化率を返す', async () => {
        // 見積 税抜10万 / 請求 税抜9.5万 / 原価5.9万
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: mockId, title: 'A', contractAmount: 0, revenueOverride: null });
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([{ total: 110000, subtotal: 100000, costTotal: null }]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([{ total: 104500, subtotal: 95000, items: '[]', projectMasterId: mockId }]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(costResult(breakdown({ totalCost: 59000 })));

        const json = await (await GET(createReq(), context)).json();

        expect(json.estimatedRevenue).toBe(100000);   // 見込み売上 = 見積(税抜)
        expect(json.confirmedRevenue).toBe(95000);    // 確定売上 = 請求(税抜)
        expect(json.isBilled).toBe(true);
        expect(json.estimatedProfit).toBe(41000);     // 見積残 = 100000 - 59000
        expect(json.confirmedProfit).toBe(36000);     // 確定利益 = 95000 - 59000
        expect(json.costConsumptionRate).toBe(59);    // 消化率 = 59000/100000
    });

    it('未請求なら確定売上0・isBilled=false（見込みのみ）', async () => {
        (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue({ id: mockId, title: 'A', contractAmount: 0, revenueOverride: null });
        (prisma.estimate.findMany as jest.Mock).mockResolvedValue([{ total: 110000, subtotal: 100000, costTotal: null }]);
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
        (computeProjectCosts as jest.Mock).mockResolvedValue(costResult(breakdown({ totalCost: 59000 })));

        const json = await (await GET(createReq(), context)).json();
        expect(json.isBilled).toBe(false);
        expect(json.confirmedRevenue).toBe(0);
        expect(json.estimatedProfit).toBe(41000);
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
        (prisma.invoice.findMany as jest.Mock).mockResolvedValue([{ total: 120000, subtotal: 109091, items: '[]', projectMasterId: mockId }]);

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
