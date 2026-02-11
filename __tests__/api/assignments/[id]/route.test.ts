/**
 * @jest-environment node
 */
import { GET, PATCH, DELETE } from '@/app/api/assignments/[id]/route'; // DELETEを追加
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectAssignment: {
            findUnique: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    stringifyJsonField: (val: any) => JSON.stringify(val),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    conflictResponse: jest.fn().mockImplementation((msg, data) => NextResponse.json({ error: msg, current: data }, { status: 409 })),
}));

jest.mock('@/utils/permissions', () => ({
    canDispatch: jest.fn(),
}));

jest.mock('@/lib/formatters', () => ({
    formatAssignment: (item: any) => item, // Passthrough for test
}));

describe('/api/assignments/[id]', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager' },
    };
    const mockId = 'assignment-1';
    const mockAssignment = {
        id: mockId,
        updatedAt: new Date('2023-01-01T00:00:00Z'),
        projectMaster: { title: 'Test Project' },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canDispatch as jest.Mock).mockReturnValue(true);
    });

    describe('GET', () => {
        it('should return assignment details', async () => {
            (prisma.projectAssignment.findUnique as jest.Mock).mockResolvedValue(mockAssignment);
            const req = new NextRequest(`http://localhost:3000/api/assignments/${mockId}`);
            const context = { params: Promise.resolve({ id: mockId }) };

            const res = await GET(req, context);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual(JSON.parse(JSON.stringify(mockAssignment)));
        });

        it('should return 404 if not found', async () => {
            (prisma.projectAssignment.findUnique as jest.Mock).mockResolvedValue(null);
            const req = new NextRequest(`http://localhost:3000/api/assignments/${mockId}`);
            const context = { params: Promise.resolve({ id: mockId }) };

            const res = await GET(req, context);

            expect(res.status).toBe(404);
        });

        it('should return 401 if unauthorized', async () => {
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
            const req = new NextRequest(`http://localhost:3000/api/assignments/${mockId}`);
            const context = { params: Promise.resolve({ id: mockId }) };

            const res = await GET(req, context);
            expect(res.status).toBe(401);
        });

        it('should return 500 on db error', async () => {
            (prisma.projectAssignment.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const req = new NextRequest(`http://localhost:3000/api/assignments/${mockId}`);
            const context = { params: Promise.resolve({ id: mockId }) };

            const res = await GET(req, context);
            expect(res.status).toBe(500);
        });
    });

    describe('PATCH', () => {
        const updateBody = {
            memberCount: 5,
            remarks: 'Updated',
            workers: ['Worker A'],
        };
        const updateReq = (body: any) => new NextRequest(`http://localhost:3000/api/assignments/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });

        it('should update assignment successfully', async () => {
            (prisma.projectAssignment.update as jest.Mock).mockResolvedValue({ ...mockAssignment, ...updateBody });
            const context = { params: Promise.resolve({ id: mockId }) };

            const res = await PATCH(updateReq(updateBody), context);

            expect(res.status).toBe(200);
            expect(prisma.projectAssignment.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: mockId },
                data: expect.objectContaining({
                    memberCount: 5,
                    remarks: 'Updated',
                    // workers update logic check (deleteMany/create) is complex to strict match in mock, 
                    // ensuring the function is called is main point or checking partial structure
                })
            }));
        });

        it('should update successfully with optimistic lock (matching time)', async () => {
            const bodyWithLock = { ...updateBody, expectedUpdatedAt: mockAssignment.updatedAt.toISOString() };

            // First findUnique for lock check
            (prisma.projectAssignment.findUnique as jest.Mock).mockResolvedValue(mockAssignment);
            // Then update
            (prisma.projectAssignment.update as jest.Mock).mockResolvedValue({ ...mockAssignment, ...updateBody });

            const context = { params: Promise.resolve({ id: mockId }) };
            const res = await PATCH(updateReq(bodyWithLock), context);

            expect(res.status).toBe(200);
        });

        it('should update successfully without optimistic lock (no expectedUpdatedAt)', async () => {
            const bodyWithoutLock = { ...updateBody };

            // Should skip findUnique and go straight to update
            (prisma.projectAssignment.update as jest.Mock).mockResolvedValue({ ...mockAssignment, ...updateBody });

            const context = { params: Promise.resolve({ id: mockId }) };
            const res = await PATCH(updateReq(bodyWithoutLock), context);

            expect(res.status).toBe(200);
            // findUnique shouldn't be called for lock check if not needed
            expect(prisma.projectAssignment.findUnique).not.toHaveBeenCalled();
        });


        it('should return 409 conflict if optimistic lock fails', async () => {
            const bodyWithLock = { ...updateBody, expectedUpdatedAt: new Date('2020-01-01').toISOString() };

            (prisma.projectAssignment.findUnique as jest.Mock).mockResolvedValue(mockAssignment); // Returns current valid time

            const context = { params: Promise.resolve({ id: mockId }) };
            const res = await PATCH(updateReq(bodyWithLock), context);

            expect(res.status).toBe(409);
            expect(prisma.projectAssignment.update).not.toHaveBeenCalled();
        });

        it('should return 404 if record not found during optimistic lock check', async () => {
            const bodyWithLock = { ...updateBody, expectedUpdatedAt: mockAssignment.updatedAt.toISOString() };
            (prisma.projectAssignment.findUnique as jest.Mock).mockResolvedValue(null);

            const context = { params: Promise.resolve({ id: mockId }) };
            const res = await PATCH(updateReq(bodyWithLock), context);

            expect(res.status).toBe(404);
        });


        it('should return 403 if user requires dispatch permission', async () => {
            (canDispatch as jest.Mock).mockReturnValue(false);
            const context = { params: Promise.resolve({ id: mockId }) };
            const res = await PATCH(updateReq(updateBody), context);

            expect(res.status).toBe(403);
        });

        it('should return 500 on db error', async () => {
            (prisma.projectAssignment.update as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const context = { params: Promise.resolve({ id: mockId }) };
            const res = await PATCH(updateReq(updateBody), context);

            expect(res.status).toBe(500);
        });
    });

    describe('DELETE', () => {
        const deleteReq = () => new NextRequest(`http://localhost:3000/api/assignments/${mockId}`, { method: 'DELETE' });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should delete assignment successfully', async () => {
            (prisma.projectAssignment.delete as jest.Mock).mockResolvedValue(mockAssignment);

            const res = await DELETE(deleteReq(), context);

            expect(res.status).toBe(200);
            expect(prisma.projectAssignment.delete).toHaveBeenCalledWith({ where: { id: mockId } });
        });

        it('should return 403 if user cannot dispatch', async () => {
            (canDispatch as jest.Mock).mockReturnValue(false);

            const res = await DELETE(deleteReq(), context);
            expect(res.status).toBe(403);
        });

        it('should return 401 if unauthorized', async () => {
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });

            const res = await DELETE(deleteReq(), context);
            expect(res.status).toBe(401);
        });

        it('should return 500 on db error', async () => {
            (prisma.projectAssignment.delete as jest.Mock).mockRejectedValue(new Error('DB Error'));

            const res = await DELETE(deleteReq(), context);
            expect(res.status).toBe(500);
        });
    });
});
