/**
 * @jest-environment node
 */
import { GET } from '@/app/api/profit-dashboard/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
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

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    parseJsonField: (val: any) => typeof val === 'string' ? JSON.parse(val) : val,
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/profit-dashboard', () => {
    const mockSession = { user: { id: 'user-1' } };

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
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        const createReq = (params = '') => new NextRequest(`http://localhost:3000/api/profit-dashboard?${params}`);

        it('should return fast mode data (estimates/revenue only)', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([mockProject]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue(mockEstimates);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue(mockInvoices);

            const res = await GET(createReq('mode=fast'));
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.mode).toBe('fast');
            expect(json.projects).toHaveLength(1);
            expect(json.projects[0].revenue).toBe(120000);
            expect(json.projects[0].totalCost).toBe(17000); // Material + Sub + Other only
            expect(json.projects[0].grossProfit).toBe(120000 - 17000);
        });

        it('should return full mode data (including labor/vehicle costs)', async () => {
            // Mock work items for full mode
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

            const res = await GET(createReq('mode=full'));
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.mode).toBe('full');
            // Labor: 240 * 2 * 30 = 14400
            expect(json.projects[0].laborCost).toBe(14400);
            // Loading: (30+30) * 0.5 * 2 * 30 = 1800
            expect(json.projects[0].loadingCost).toBe(1800);
            // Vehicle: 5000 * 1 = 5000
            expect(json.projects[0].vehicleCost).toBe(5000);

            const expectedTotalCost = 14400 + 1800 + 5000 + 17000; // 38200
            expect(json.projects[0].totalCost).toBe(expectedTotalCost);
        });

        it('should handle empty project list', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

            const res = await GET(createReq());
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.projects).toEqual([]);
            expect(json.summary.totalProjects).toBe(0);
        });

        it('should handle disjoint data (missing estimates/invoices)', async () => {
            (prisma.projectMaster.findMany as jest.Mock).mockResolvedValue([mockProject]);
            (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]); // No estimates
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]); // No revenue

            const res = await GET(createReq('mode=fast'));
            const json = await res.json();

            expect(json.projects[0].revenue).toBe(0);
            expect(json.projects[0].estimateAmount).toBe(0);
            expect(json.summary.totalRevenue).toBe(0);
        });
    });
});
