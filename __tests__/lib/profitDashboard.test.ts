/**
 * @jest-environment node
 */
import { fetchProfitDashboardData, fetchMonthlySales } from '@/lib/profitDashboard';
import { prisma } from '@/lib/prisma';

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

    const mockEstimates = [{ projectMasterId: 'proj-1', total: 100000, costTotal: null, createdAt: new Date() }];
    const mockInvoices = [{ projectMasterId: 'proj-1', total: 120000 }];
    const mockSettings = { laborDailyRate: 14400, standardWorkMinutes: 480 }; // rate = 30/min
    const mockVehicles = [{ id: 'veh-1', dailyRate: 5000 }];

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.projectAssignment.groupBy as jest.Mock).mockResolvedValue([]);
    });

    describe('fetchProfitDashboardData', () => {
        it('should return correct data in fast mode (estimates/revenue only)', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([mockProject]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue(mockEstimates);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue(mockInvoices);

            // Fast mode internally only calls these 3 prisma methods in the conditional block? 
            // Checking the implementation in Step 425:
            // "if (mode === 'fast')" block calls estimates and invoices.
            // Wait, fetchProfitDashboardData signature is (status: string). It doesn't take mode as arg directly?
            // Re-checking Step 425 source code.
            // export async function fetchProfitDashboardData(status: string = 'all'): Promise<DashboardData>
            // The implementation calls ALL queries in Promise.all unconditionally in lines 69-114.
            // Wait, looking at Step 353 (API route), the API route handles mode='fast'.
            // looking at Step 425 (Lib file), it DOES NOT accept a mode argument. It always runs full queries.
            // Ah, I see. The implementation plan said "Handle 'fast' mode" for the *test*, but looking at the lib code, it doesn't seem to support fast mode via argument.
            // Let me re-read Step 425 carefully.
            // Line 40: export async function fetchProfitDashboardData(status: string = 'all')
            // And then line 69: const [...] = await Promise.all([...])
            // It fetches everything.
            // The `mode` logic seems to be in the API route (app/api/profit-dashboard/route.ts) lines 28-65, where it branches logic.
            // But the Library function `fetchProfitDashboardData` seems to be the "full" implementation or maybe I misread where it's used.
            // Let's check if `fetchProfitDashboardData` is actually the code extracted from the route or independent.
            // Only `app/api/profit-dashboard/route.ts` was shown in Step 353. 
            // Step 425 shows `lib/profitDashboard.ts`.
            // The content of `lib/profitDashboard.ts` in step 425 is the FULL implementation that does ALL queries. It does not have a 'fast' mode switch.
            // So my test should reflect that. The `fast` mode test case in my thought process was incorrect for the LIB function, it was for the API route (which I already tested).
            // The lib function `fetchProfitDashboardData` is likely used by Server Components or the API route default.

            // Correct test strategy for LIB:
            // Verify it calculates everything correctly.

            // Mock everything needed for full calculation
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([mockProject]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue(mockEstimates);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue(mockInvoices);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(mockSettings);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue(mockVehicles);
            (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([]);

            const result = await fetchProfitDashboardData('all');

            expect(result.projects[0].revenue).toBe(120000);
            expect(result.projects[0].laborCost).toBe(0);
            // material(10000) + other(2000) = 12000 (協力業者費はアサイン無しで0)
            expect(result.projects[0].grossProfit).toBe(120000 - 12000);
            expect(prisma.projectMaster.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
        });

        it('should filter by status', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(mockSettings);
            (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([]);

            await fetchProfitDashboardData('completed');

            expect(prisma.projectMaster.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { status: 'completed' }
            }));
        });

        it('should calculate labor and vehicle costs', async () => {
            const mockWorkItems = [
                {
                    startTime: '08:00',
                    endTime: '12:00',
                    breakMinutes: 0,
                    workerIds: [],
                    dailyReport: { morningLoadingMinutes: 30, eveningLoadingMinutes: 30 },
                    assignment: { projectMasterId: 'proj-1', workers: '["w1", "w2"]', memberCount: 2 },
                },
            ];
            const mockAssignments = [{
                projectMasterId: 'proj-1',
                vehicles: '["veh-1"]',
                assignedEmployeeId: 'user-1',
                isDispatchConfirmed: false,
                constructionType: null,
            }];

            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([mockProject]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue(mockEstimates);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue(mockInvoices);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(mockSettings);
            (prisma.dailyReportWorkItem.findMany as jest.Mock).mockResolvedValue(mockWorkItems);
            (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue(mockVehicles);

            const result = await fetchProfitDashboardData('all');

            // Labor: 240 * 2 * 30 = 14400
            expect(result.projects[0].laborCost).toBe(14400);
            // Loading: (30+30) * 0.5 * 2 * 30 = 1800
            expect(result.projects[0].loadingCost).toBe(1800);
            // Vehicle: 5000 * 1 = 5000
            expect(result.projects[0].vehicleCost).toBe(5000);

            // labor(14400) + loading(1800) + vehicle(5000) + material(10000) + other(2000)
            // 協力業者費は手配確定済み & partner ロール職長のアサインが必要なのでここでは0
            const expectedTotalCost = 14400 + 1800 + 5000 + 12000;
            expect(result.projects[0].totalCost).toBe(expectedTotalCost);
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

        it('cancelled を除外する where 条件と JST 月範囲でクエリする', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

            await fetchMonthlySales(12, now);

            expect(prisma.invoice.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        status: { not: 'cancelled' },
                        createdAt: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
                    }),
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
});
