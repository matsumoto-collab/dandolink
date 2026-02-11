/**
 * @jest-environment node
 */
import { POST } from '@/app/api/assignments/batch/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        $transaction: jest.fn(),
        projectAssignment: {
            findMany: jest.fn(),
            update: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    stringifyJsonField: (val: any) => JSON.stringify(val),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    conflictResponse: jest.fn().mockImplementation((msg, data) => NextResponse.json({ error: msg, current: data }, { status: 409 })),
}));

jest.mock('@/utils/permissions', () => ({
    canDispatch: jest.fn(),
}));

jest.mock('@/lib/formatters', () => ({
    formatAssignment: (item: any) => item, // Passthrough for test
}));

describe('/api/assignments/batch', () => {
    const mockSession = { user: { id: 'u1', role: 'manager' } };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canDispatch as jest.Mock).mockReturnValue(true);
    });

    const mockUpdates = [
        { id: '1', data: { memberCount: 3 } },
        { id: '2', data: { remarks: 'test' } },
    ];

    const postReq = (updates: any) => new NextRequest('http://localhost:3000/api/assignments/batch', {
        method: 'POST',
        body: JSON.stringify({ updates }),
    });

    it('should update multiple assignments successfully', async () => {
        (prisma.$transaction as jest.Mock).mockResolvedValue([
            { id: '1', memberCount: 3 },
            { id: '2', remarks: 'test' },
        ]);

        const res = await POST(postReq(mockUpdates));

        expect(res.status).toBe(200);
        expect(prisma.$transaction).toHaveBeenCalled();
        expect(await res.json()).toEqual({ success: true, count: 2 });
    });

    it('should handle optimistic locking success', async () => {
        const updatesWithLock = [
            { id: '1', expectedUpdatedAt: '2023-01-01T00:00:00Z', data: { memberCount: 3 } }
        ];

        const currentRecord = {
            id: '1',
            updatedAt: new Date('2023-01-01T00:00:00Z'),
            projectMaster: { title: 'Test' }
        };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([currentRecord]);
        (prisma.$transaction as jest.Mock).mockResolvedValue([{ id: '1' }]);

        const res = await POST(postReq(updatesWithLock));

        expect(res.status).toBe(200);
        expect(prisma.projectAssignment.findMany).toHaveBeenCalled();
    });

    it('should update successfully without optimistic lock (no expectedUpdatedAt)', async () => {
        // Just standard update flow without pre-check
        (prisma.$transaction as jest.Mock).mockResolvedValue([
            { id: '1', memberCount: 3 },
        ]);

        const res = await POST(postReq(mockUpdates));

        expect(res.status).toBe(200);
        // findMany should not be called for lock checking
        expect(prisma.projectAssignment.findMany).not.toHaveBeenCalled();
    });


    it('should return 409 conflict if optimistic lock fails', async () => {
        const updatesWithLock = [
            { id: '1', expectedUpdatedAt: '2023-01-01T00:00:00Z', data: { memberCount: 3 } }
        ];

        const currentRecord = {
            id: '1',
            updatedAt: new Date('2023-01-02T00:00:00Z'), // Different time
            projectMaster: { title: 'Test' }
        };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([currentRecord]);

        const res = await POST(postReq(updatesWithLock));

        expect(res.status).toBe(409);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should return 400 if updates array is missing', async () => {
        const req = new NextRequest('http://localhost:3000/api/assignments/batch', {
            method: 'POST',
            body: JSON.stringify({}),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('should return 400 if record not found during lock check (with expectedUpdatedAt)', async () => {
        const updatesWithLock = [
            { id: '999', expectedUpdatedAt: '2023-01-01T00:00:00Z', data: { memberCount: 3 } }
        ];
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValue([]); // Empty result

        const res = await POST(postReq(updatesWithLock));
        expect(res.status).toBe(400);
    });

    it('should return 500 if record not found during update (without expectedUpdatedAt)', async () => {
        // Without expectedUpdatedAt, it goes straight to transaction.
        // If ID doesn't exist, prisma.update throws error inside transaction.
        // We mock transaction failure here.
        (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('Record to update not found.'));

        const res = await POST(postReq(mockUpdates));
        expect(res.status).toBe(500);
    });


    it('should return 403 if unauthorized', async () => {
        (canDispatch as jest.Mock).mockReturnValue(false);
        const res = await POST(postReq(mockUpdates));
        expect(res.status).toBe(403);
    });

    it('should return 500 on db error in transaction', async () => {
        (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB Error'));
        const res = await POST(postReq(mockUpdates));
        expect(res.status).toBe(500);
    });
});
