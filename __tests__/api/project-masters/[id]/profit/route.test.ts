/**
 * @jest-environment node
 */
import { GET } from '@/app/api/project-masters/[id]/profit/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectMaster: {
            findUnique: jest.fn(),
        },
        systemSettings: {
            findFirst: jest.fn(),
        },
        estimate: {
            findMany: jest.fn(),
        },
        invoice: {
            findMany: jest.fn(),
        },
        vehicle: {
            findMany: jest.fn(),
        },
        dailyReportWorkItem: {
            groupBy: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    parseJsonField: (val: any) => typeof val === 'string' ? JSON.parse(val) : val,
    notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/project-masters/[id]/profit', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'proj-1';

    // Mock Data
    const mockProject = {
        id: mockId,
        title: 'Project A',
        materialCost: 10000,
        subcontractorCost: 5000,
        otherExpenses: 2000,
        assignments: [],
    };

    const mockSettings = { laborDailyRate: 14400, standardWorkMinutes: 480 }; // rate = 30/min
    const mockEstimates = [{ total: 100000 }];
    const mockInvoices = [{ total: 120000 }];
    const mockVehicles = [{ id: 'veh-1', dailyRate: 5000 }];

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/project-masters/${mockId}/profit`);
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should calculate profit correctly with minimal data', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(mockProject);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(mockSettings);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue(mockEstimates);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue(mockInvoices);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue(mockVehicles);

            const res = await GET(createReq(), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.revenue).toBe(120000);
            expect(json.estimateAmount).toBe(100000);
            // Costs: Material(10000) + Sub(5000) + Other(2000) = 17000
            expect(json.costBreakdown.totalCost).toBe(17000);
            expect(json.grossProfit).toBe(120000 - 17000);
        });

        it('should calculate labor and vehicle costs from assignments', async () => {
            // 1 assignment, 2 workers, 1 vehicle, 240 mins work (half day)
            const mockAssignment = {
                workers: '["w1", "w2"]',
                vehicles: '["veh-1"]',
                dailyReportWorkItems: [
                    {
                        workMinutes: 240,
                        dailyReport: {
                            id: 'rep-1',
                            morningLoadingMinutes: 30,
                            eveningLoadingMinutes: 30,
                        },
                    },
                ],
            };
            const mockProjectWithAssign = { ...mockProject, assignments: [mockAssignment] };

            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(mockProjectWithAssign);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(mockSettings); // rate = 30
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue(mockVehicles);

            // Mock groupBy for loading calculation ratio
            // Total work for report is 480 mins (assuming full day report elsewhere, but here logic uses summary)
            // If workItem is 240, and report total is 480, ratio is 0.5.
            (prisma.dailyReportWorkItem.groupBy as jest.Mock).mockResolvedValue([
                { dailyReportId: 'rep-1', _sum: { workMinutes: 480 } },
            ]);

            const res = await GET(createReq(), context);
            const json = await res.json();

            // Vehicle Cost: 5000 * 1 = 5000
            expect(json.costBreakdown.vehicleCost).toBe(5000);

            // Labor Cost: 240 min * 2 workers * 30 JPY/min = 14400
            expect(json.costBreakdown.laborCost).toBe(14400);

            // Loading Cost: (30+30) * (240/480) * 2 workers * 30 JPY/min 
            // = 60 * 0.5 * 2 * 30 = 30 * 2 * 30 = 1800
            expect(json.costBreakdown.loadingCost).toBe(1800);
        });

        it('should handle missing settings (fallback defaults)', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(mockProject);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null); // Defaults: 15000 / 480 = 31.25 rate
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([]);

            const res = await GET(createReq(), context);
            expect(res.status).toBe(200);
        });

        it('should return 404 if project not found', async () => {
            (prisma.projectMaster.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await GET(createReq(), context);
            expect(res.status).toBe(404);
        });
    });
});
