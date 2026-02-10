/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/assignments/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, applyRateLimit } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectAssignment: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    applyRateLimit: jest.fn(), // Return null (no error) by default
    stringifyJsonField: (val: any) => JSON.stringify(val),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    validationErrorResponse: jest.fn().mockImplementation((error) => NextResponse.json({ error: 'Validation Error', details: error }, { status: 400 })),
    RATE_LIMITS: { api: 'limit' },
}));

jest.mock('@/utils/permissions', () => ({
    canDispatch: jest.fn(),
}));

jest.mock('@/lib/formatters', () => ({
    formatAssignment: (item: any) => item, // Passthrough for test
}));

describe('/api/assignments', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager' },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (applyRateLimit as jest.Mock).mockReturnValue(null);
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canDispatch as jest.Mock).mockReturnValue(true);
    });

    describe('GET', () => {
        it('should return assignments list', async () => {
            const mockAssignments = [
                { id: '1', date: new Date('2023-01-01'), projectMaster: { title: 'Test' } },
            ];
            (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue(mockAssignments);

            const req = new NextRequest('http://localhost:3000/api/assignments?startDate=2023-01-01&endDate=2023-01-07');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual(JSON.parse(JSON.stringify(mockAssignments)));
            expect(prisma.projectAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    date: {
                        gte: expect.any(Date),
                        lte: expect.any(Date),
                    },
                }),
            }));
        });

        it('should handle auth error', async () => {
            const errorRes = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: errorRes });

            const req = new NextRequest('http://localhost:3000/api/assignments');
            const res = await GET(req);

            expect(res.status).toBe(401);
        });
    });

    describe('POST', () => {
        const validBody = {
            projectMasterId: 'pm-1',
            assignedEmployeeId: 'emp-1',
            date: '2023-01-01',
            memberCount: 2,
            workers: ['w1', 'w2'],
            vehicles: ['v1'],
            isDispatchConfirmed: true,
        };

        it('should create an assignment', async () => {
            (prisma.projectAssignment.findUnique as jest.Mock).mockResolvedValue(null); // No duplicate

            const createdAssignment = { id: 'new-1', ...validBody };
            (prisma.projectAssignment.create as jest.Mock).mockResolvedValue(createdAssignment);

            const req = new NextRequest('http://localhost:3000/api/assignments', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(prisma.projectAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    projectMasterId: 'pm-1',
                    assignedEmployeeId: 'emp-1',
                    workers: JSON.stringify(['w1', 'w2']), // Verify stringify behavior
                })
            }));
        });

        it('should return 400 validation error for invalid data', async () => {
            const invalidBody = { ...validBody, projectMasterId: undefined }; // Missing required field

            const req = new NextRequest('http://localhost:3000/api/assignments', {
                method: 'POST',
                body: JSON.stringify(invalidBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(400); // Validation error response
        });

        it('should allow duplicate assignment', async () => {
            (prisma.projectAssignment.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });

            const req = new NextRequest('http://localhost:3000/api/assignments', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            // 重複チェックは削除されたため、作成処理が走る（モックの挙動に従う）
            const createdAssignment = { id: 'new-duplicate', ...validBody };
            (prisma.projectAssignment.create as jest.Mock).mockResolvedValue(createdAssignment);

            const res = await POST(req);
            expect(res.status).toBe(200);
        });

        it('should return 403 if user cannot dispatch', async () => {
            (canDispatch as jest.Mock).mockReturnValue(false);

            const req = new NextRequest('http://localhost:3000/api/assignments', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(403);
        });
    });
});
