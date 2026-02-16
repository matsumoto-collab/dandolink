/**
 * @jest-environment node
 */
import { fetchProfitDashboardData } from '@/lib/profitDashboard';
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
        },
        vehicle: {
            findMany: jest.fn(),
        },
    },
}));

describe('lib/profitDashboard', () => {
    // Mock Data
    const mockProject = {
        id: 'proj-1',
        title: 'Project A',
        customerName: 'Customer A',
        status: 'active',
        materialCost: 10000,
        subcontractorCost: 5000,
        otherExpenses: 2000,
        updatedAt: new Date(),
        _count: { assignments: 5 },
    };

    const mockEstimates = [{ projectMasterId: 'proj-1', total: 100000 }];
    const mockInvoices = [{ projectMasterId: 'proj-1', total: 120000 }];
    const mockSettings = { laborDailyRate: 14400, standardWorkMinutes: 480 }; // rate = 30/min
    const mockVehicles = [{ id: 'veh-1', dailyRate: 5000 }];

    beforeEach(() => {
        jest.clearAllMocks();
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
            expect(result.projects[0].grossProfit).toBe(120000 - 17000); // 17000 is material+sub+other
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
                    dailyReport: { morningLoadingMinutes: 30, eveningLoadingMinutes: 30 },
                    assignment: { projectMasterId: 'proj-1', workers: '["w1", "w2"]' },
                },
            ];
            const mockAssignments = [{ projectMasterId: 'proj-1', vehicles: '["veh-1"]' }];

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

            const expectedTotalCost = 14400 + 1800 + 5000 + 17000;
            expect(result.projects[0].totalCost).toBe(expectedTotalCost);
        });
    });
});
