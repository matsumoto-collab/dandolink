/**
 * @jest-environment node
 */
import { fetchProfitDashboardData, fetchMonthlySales, fetchMonthlyAssigneeBreakdown } from '@/lib/profitDashboard';
import { prisma } from '@/lib/prisma';
import { computeProjectCosts } from '@/lib/projectCost';

// 原価エンジンは projectCost.test.ts で単体検証済み。ここでは結果をモックして売上/グルーピングに集中する。
jest.mock('@/lib/projectCost', () => ({ computeProjectCosts: jest.fn() }));

// projectId → totalCost のモック原価マップを返すヘルパ
const mockCosts = (costs: Record<string, number> = {}) =>
    (ids: string[]) => new Map(ids.map(id => [id, {
        breakdown: { laborCost: 0, loadingCost: 0, vehicleCost: 0, materialCost: 0, subcontractorCost: 0, otherExpenses: 0, totalCost: costs[id] ?? 0 },
    }]));

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectMaster: {
            findMany: jest.fn(),
        },
        estimate: {
            findMany: jest.fn(),
        },
        invoice: {
            findMany: jest.fn(),
        },
        systemSettings: {
            findFirst: jest.fn(),
        },
        dailyReportWorkItem: {
            findMany: jest.fn(),
        },
        projectAssignment: {
            findMany: jest.fn(),
            groupBy: jest.fn(),
        },
        vehicle: {
            findMany: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
        },
        worker: {
            findMany: jest.fn(),
        },
        constructionType: {
            findMany: jest.fn(),
        },
        monthlyAssigneeCostOverride: {
            findMany: jest.fn(),
        },
        monthlyProjectCostOverride: {
            findMany: jest.fn(),
        },
    },
}));

describe('lib/profitDashboard', () => {
    // Mock Data
    // 協力業者費はアサイン無しの場合0になる（手配確定済み & パートナーロール判定が必要）
    const mockProject = {
        id: 'proj-1',
        title: 'Project A',
        customerName: 'Customer A',
        status: 'active',
        constructionType: null,
        contractAmount: 0,
        materialCost: 10000,
        otherExpenses: 2000,
        subcontractorCosts: [],
        updatedAt: new Date(),
        _count: { assignments: 5 },
    };

    const mockEstimates = [{ projectMasterId: 'proj-1', subtotal: 100000, costTotal: null, createdAt: new Date() }];
    const mockInvoices = [{ projectMasterId: 'proj-1', subtotal: 120000 }];

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.projectAssignment.groupBy as jest.Mock).mockResolvedValue([]);
        (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({}));
    });

    describe('fetchProfitDashboardData', () => {
        it('売上（請求書フォールバック）と computeProjectCosts の確定原価から粗利を出す', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([mockProject]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue(mockEstimates);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue(mockInvoices);
            (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({ 'proj-1': 12000 }));

            const result = await fetchProfitDashboardData('all');

            expect(result.projects[0].revenue).toBe(120000);   // 請求書優先
            expect(result.projects[0].totalCost).toBe(12000);   // 共通エンジンの確定原価
            expect(result.projects[0].grossProfit).toBe(108000);
            expect(computeProjectCosts).toHaveBeenCalledWith(['proj-1']);
            expect(prisma.projectMaster.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        });

        it('ステータスで案件を絞り込む', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

            await fetchProfitDashboardData('completed');

            expect(prisma.projectMaster.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { status: 'completed' },
            }));
        });
    });

    describe('fetchMonthlySales', () => {
        // JST 2026-06-15 09:00（= UTC 00:00）。当月=2026年6月、前月=2026年5月。
        const now = new Date('2026-06-15T00:00:00Z');

        it('当月・前月を JST 月で振り分け、前月比を算出する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { total: 100000, createdAt: new Date('2026-06-10T03:00:00Z') }, // JST 6月
                { total: 50000, createdAt: new Date('2026-05-20T03:00:00Z') },  // JST 5月
            ]);

            const r = await fetchMonthlySales(12, now);

            expect(r.current.year).toBe(2026);
            expect(r.current.month).toBe(6);
            expect(r.current.sales).toBe(100000);
            expect(r.current.invoiceCount).toBe(1);
            expect(r.previous.month).toBe(5);
            expect(r.previous.sales).toBe(50000);
            expect(r.momDelta).toBe(50000);
            expect(r.momPercent).toBe(100); // (100000-50000)/50000 = +100%
            expect(r.trend).toHaveLength(12);
            // trend は古い→新しい。末尾が当月。
            expect(r.trend[r.trend.length - 1]).toMatchObject({ year: 2026, month: 6, sales: 100000 });
            expect(r.trend[r.trend.length - 2]).toMatchObject({ month: 5, sales: 50000 });
            expect(r.trend[0]).toMatchObject({ year: 2025, month: 7 }); // 12ヶ月前
        });

        it('UTC 月末深夜は JST 翌月（=当月）として集計する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { total: 30000, createdAt: new Date('2026-05-31T15:30:00Z') }, // JST 6/1 00:30 → 6月
                { total: 70000, createdAt: new Date('2026-05-31T14:30:00Z') }, // JST 5/31 23:30 → 5月
            ]);

            const r = await fetchMonthlySales(12, now);

            expect(r.current.sales).toBe(30000);
            expect(r.previous.sales).toBe(70000);
        });

        it('送付済み以降のみ計上する where 条件と JST 月範囲・税込(total)でクエリする', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

            await fetchMonthlySales(12, now);

            expect(prisma.invoice.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: { in: ['sent', 'paid', 'overdue'] },
                        createdAt: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
                    }),
                    // 月次売上は税込（kei 決定 2026-07-07）。担当者別/顧客別内訳は税抜のまま
                    select: { total: true, createdAt: true },
                }),
            );
            // lt は翌月初(JST) = 2026-07-01 00:00 JST = 2026-06-30T15:00:00Z
            const arg = (prisma.invoice.findMany as jest.Mock).mock.calls[0][0];
            expect(arg.where.createdAt.lt.toISOString()).toBe('2026-06-30T15:00:00.000Z');
            // gte は11ヶ月前の月初(JST) = 2025-07-01 00:00 JST = 2025-06-30T15:00:00Z
            expect(arg.where.createdAt.gte.toISOString()).toBe('2025-06-30T15:00:00.000Z');
        });

        it('前月が 0 のとき momPercent は null', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { total: 80000, createdAt: new Date('2026-06-05T03:00:00Z') },
            ]);

            const r = await fetchMonthlySales(12, now);

            expect(r.current.sales).toBe(80000);
            expect(r.previous.sales).toBe(0);
            expect(r.momDelta).toBe(80000);
            expect(r.momPercent).toBeNull();
        });

        it('請求書が無ければすべて 0・momPercent は null', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

            const r = await fetchMonthlySales(12, now);

            expect(r.current.sales).toBe(0);
            expect(r.previous.sales).toBe(0);
            expect(r.momPercent).toBeNull();
            expect(r.trend).toHaveLength(12);
            expect(r.trend.every(p => p.sales === 0 && p.invoiceCount === 0)).toBe(true);
        });
    });

    describe('fetchMonthlyAssigneeBreakdown', () => {
        beforeEach(() => {
            // 既定は全部空。原価は computeProjectCosts をモック（既定 0）。
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
            (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({}));
        });

        it('案件の売上を主担当へ全額計上する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 100000, items: '[{"projectMasterId":"p1","amount":90909}]', projectMasterId: 'p1' },
            ]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '案件1', title: '案件1' }]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A', dailyRate: null, role: 'manager' }]);

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]).toMatchObject({ key: 'u1', name: '担当A', sales: 100000, cost: 0, grossProfit: 100000 });
            // 案件明細（展開時に見える行）
            expect(r.rows[0].items).toHaveLength(1);
            expect(r.rows[0].items[0]).toMatchObject({ projectId: 'p1', projectName: '案件1', sales: 100000, cost: 0 });
            expect(r.totals).toEqual({ sales: 100000, cost: 0, grossProfit: 100000 });
        });

        it('複数案件まとめ請求は明細額で按分し、各案件の主担当へ計上する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 100000, items: '[{"projectMasterId":"p1","amount":30000},{"projectMasterId":"p2","amount":70000}]', projectMasterId: 'p1' },
            ]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
                { id: 'p1', createdBy: '["u1"]' },
                { id: 'p2', createdBy: '["u2"]' },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([
                { id: 'u1', displayName: '担当A', dailyRate: null, role: 'manager' },
                { id: 'u2', displayName: '担当B', dailyRate: null, role: 'manager' },
            ]);

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

            const byId = Object.fromEntries(r.rows.map(x => [x.key, x.sales]));
            expect(byId['u1']).toBe(30000);
            expect(byId['u2']).toBe(70000);
            expect(r.totals.sales).toBe(100000);
        });

        it('案件の確定原価（computeProjectCosts）を主担当に集約する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 100000, items: '[{"projectMasterId":"p1","amount":90909}]', projectMasterId: 'p1' },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A' }]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '案件1', title: '案件1' }]);
            // 原価は共通エンジンの確定値（人件費＋車両費＋材料費＋外注費＋その他）
            (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({ p1: 25000 }));

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]).toMatchObject({ key: 'u1', sales: 100000, cost: 25000, grossProfit: 75000 });
            expect(computeProjectCosts).toHaveBeenCalledWith(['p1']);
        });

        it('担当者・案件のない請求は「未設定」バケットへ集約する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 50000, items: '[]', projectMasterId: null },
            ]);

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6 });

            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]).toMatchObject({ key: '__unassigned__', name: '(担当者未設定)', sales: 50000 });
        });

        it('顧客別に集計できる（axis=customer・案件名は正式名称＋顧客名）', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 100000, items: '[{"projectMasterId":"p1","amount":90909}]', projectMasterId: 'p1' },
            ]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([
                { id: 'p1', createdBy: '["u1"]', name: '佐藤', title: '佐藤様邸 仮設工事', customerName: '佐藤建設' },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A', dailyRate: null, role: 'manager' }]);

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6, axis: 'customer' });

            expect(r.axis).toBe('customer');
            expect(r.rows).toHaveLength(1);
            expect(r.rows[0]).toMatchObject({ key: '佐藤建設', name: '佐藤建設', sales: 100000 });
            // 案件名は title（敬称・工事名称込み）＋顧客名を保持
            expect(r.rows[0].items[0]).toMatchObject({ projectName: '佐藤様邸 仮設工事', customerName: '佐藤建設' });
        });

        it('年間(period=year)は当年に請求のあった案件を集計する', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
                { subtotal: 200000, items: '[{"projectMasterId":"p1","amount":180000}]', projectMasterId: 'p1' },
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', displayName: '担当A' }]);
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', createdBy: '["u1"]', name: '案件1', title: '案件1', customerName: '顧客X' }]);
            (computeProjectCosts as jest.Mock).mockImplementation(mockCosts({ p1: 40000 }));

            const r = await fetchMonthlyAssigneeBreakdown({ year: 2026, month: 6, period: 'year' });

            expect(r.period).toBe('year');
            const u1 = r.rows.find(x => x.key === 'u1')!;
            expect(u1.sales).toBe(200000);
            expect(u1.cost).toBe(40000);
        });
    });
});
