/**
 * @jest-environment node
 */
import { POST } from '@/app/api/assignments/batch-create/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, applyRateLimit } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: jest.fn(),
        projectAssignment: {
            create: jest.fn(),
            findMany: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    applyRateLimit: jest.fn(),
    stringifyJsonField: (val: any) => JSON.stringify(val),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    RATE_LIMITS: { api: 'limit' },
}));

jest.mock('@/utils/permissions', () => ({
    canDispatch: jest.fn(),
}));

jest.mock('@/lib/formatters', () => ({
    formatAssignment: (item: any) => item,
}));

describe('/api/assignments/batch-create', () => {
    const mockSession = { user: { id: 'u1', role: 'manager' } };

    beforeEach(() => {
        jest.clearAllMocks();
        (applyRateLimit as jest.Mock).mockReturnValue(null);
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canDispatch as jest.Mock).mockReturnValue(true);
    });

    const validAssignment = {
        projectMasterId: 'pm1',
        assignedEmployeeId: 'emp1',
        date: '2023-01-01',
    };

    const postReq = (assignments: any) => new NextRequest('http://localhost:3000/api/assignments/batch-create', {
        method: 'POST',
        body: JSON.stringify({ assignments }),
    });

    it('should create multiple assignments successfully', async () => {
        const assignments = [validAssignment, { ...validAssignment, date: '2023-01-02' }];
        const mockCreated = [{ id: 'id-1' }, { id: 'id-2' }];
        const mockResults = [
            { id: 'id-1', projectMasterId: 'pm1', assignedEmployeeId: 'emp1', date: new Date('2023-01-01') },
            { id: 'id-2', projectMasterId: 'pm1', assignedEmployeeId: 'emp1', date: new Date('2023-01-02') },
        ];
        (prisma.$transaction as jest.Mock).mockResolvedValue(mockCreated);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue(mockResults);

        const res = await POST(postReq(assignments));

        expect(res.status).toBe(200);
        expect(prisma.$transaction).toHaveBeenCalled();
        const json = await res.json();
        expect(json).toHaveLength(2);
    });

    it('should return 400 if assignments array is missing or empty', async () => {
        const res = await POST(postReq([]));
        expect(res.status).toBe(400);
    });

    it('should return 400 if assignments exceed 100', async () => {
        const largeArray = new Array(101).fill(validAssignment);
        const res = await POST(postReq(largeArray));
        expect(res.status).toBe(400);
    });

    it('should return 400 if required fields are missing', async () => {
        const invalidAssignment = { projectMasterId: 'pm1' }; // missing others
        const res = await POST(postReq([invalidAssignment]));
        expect(res.status).toBe(400);
    });

    it('should return 403 if unauthorized', async () => {
        (canDispatch as jest.Mock).mockReturnValue(false);
        const res = await POST(postReq([validAssignment]));
        expect(res.status).toBe(403);
    });

    it('should return 429 if rate limit exceeded', async () => {
        (applyRateLimit as jest.Mock).mockReturnValue(
            NextResponse.json({ error: 'Too Many Requests' }, { status: 429 })
        );

        const res = await POST(postReq([validAssignment]));
        expect(res.status).toBe(429);
    });

    it('should return 500 on db error', async () => {
        (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB Error'));
        const res = await POST(postReq([validAssignment]));
        expect(res.status).toBe(500);
    });
});
