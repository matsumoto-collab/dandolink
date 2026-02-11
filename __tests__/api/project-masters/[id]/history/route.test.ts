/**
 * @jest-environment node
 */
import { GET } from '@/app/api/project-masters/[id]/history/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectAssignment: {
            findMany: jest.fn(),
        },
        user: {
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

describe('/api/project-masters/[id]/history', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'proj-1';

    // Mock Data
    const mockAssignment = {
        id: 'assign-1',
        date: new Date('2023-10-01'),
        assignedEmployeeId: 'emp-1',
        projectMasterId: mockId,
        projectMaster: { constructionType: 'Type A', constructionContent: 'Content A' },
        confirmedWorkerIds: '["worker-1"]',
        workers: '[]',
        confirmedVehicleIds: '["veh-1"]',
        vehicles: '[]',
        isDispatchConfirmed: true,
        remarks: 'Done',
        createdAt: new Date('2023-09-30'),
    };

    const mockUserForeman = { id: 'emp-1', displayName: 'Foreman A' };
    const mockUserWorker = { id: 'worker-1', displayName: 'Worker A' };
    const mockVehicle = { id: 'veh-1', name: 'Vehicle A' };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/project-masters/${mockId}/history`);
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should fetch project history successfully', async () => {
            (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([mockAssignment]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([mockUserForeman, mockUserWorker]);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([mockVehicle]);

            const res = await GET(createReq(), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toHaveLength(1);
            expect(json[0].foremanName).toBe('Foreman A');
            expect(json[0].workerNames).toContain('Worker A');
            expect(json[0].vehicleNames).toContain('Vehicle A');

            // Verify JSON parsing logic via mock call checks is implied by result correctness
        });

        it('should handle unconfirmed workers/vehicles (fallback to planned)', async () => {
            const mockAssignmentUnconfirmed = {
                ...mockAssignment,
                confirmedWorkerIds: null,
                workers: '["worker-1"]',
                confirmedVehicleIds: null,
                vehicles: '["veh-1"]',
            };
            (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([mockAssignmentUnconfirmed]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([mockUserForeman, mockUserWorker]);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([mockVehicle]);

            const res = await GET(createReq(), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json[0].workerNames).toContain('Worker A');
            expect(json[0].vehicleNames).toContain('Vehicle A');
        });

        it('should return empty list if no assignments', async () => {
            (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([]);

            const res = await GET(createReq(), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual([]);
        });
    });
});
