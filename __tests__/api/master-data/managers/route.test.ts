/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/master-data/managers/route';
import { PATCH, DELETE } from '@/app/api/master-data/managers/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        manager: {
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    validateStringField: (val: any) => val,
}));

jest.mock('@/utils/permissions', () => ({
    isManagerOrAbove: jest.fn(),
}));

describe('/api/master-data/managers', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockManager = { id: 'mgr-1', name: 'Manager A', isActive: true };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
    });

    describe('GET', () => {
        const createReq = () => new NextRequest('http://localhost:3000/api/master-data/managers');

        it('should fetch active managers', async () => {
            (prisma.manager.findMany as jest.Mock).mockResolvedValue([mockManager]);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual([mockManager]);
            expect(prisma.manager.findMany).toHaveBeenCalledWith({
                where: { isActive: true },
                orderBy: { name: 'asc' },
            });
        });
    });

    describe('POST', () => {
        const createReq = (body: any) => new NextRequest('http://localhost:3000/api/master-data/managers', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        it('should create manager successfully', async () => {
            (prisma.manager.create as jest.Mock).mockResolvedValue(mockManager);
            const res = await POST(createReq({ name: 'Manager A' }));
            const json = await res.json();

            expect(res.status).toBe(201);
            expect(json).toEqual(mockManager);
        });

        it('should return 400 if name is missing', async () => {
            const res = await POST(createReq({}));
            expect(res.status).toBe(400);
        });
    });
});

describe('/api/master-data/managers/[id]', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'mgr-1';
    const mockManager = { id: mockId, name: 'Manager A', isActive: true };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
    });

    describe('PATCH', () => {
        const createReq = (body: any) => new NextRequest(`http://localhost:3000/api/master-data/managers/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        const context = { params: { id: mockId } }; // Object, not Promise, based on previous findings

        it('should update manager successfully', async () => {
            (prisma.manager.update as jest.Mock).mockResolvedValue({ ...mockManager, name: 'Updated' });

            const res = await PATCH(createReq({ name: 'Updated' }), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.name).toBe('Updated');
        });

        it('should return 403 if not authorized', async () => {
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);
            const res = await PATCH(createReq({ name: 'Updated' }), context);
            expect(res.status).toBe(403);
        });
    });

    describe('DELETE', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/master-data/managers/${mockId}`, { method: 'DELETE' });
        const context = { params: { id: mockId } };

        it('should soft delete manager successfully', async () => {
            (prisma.manager.update as jest.Mock).mockResolvedValue({ ...mockManager, isActive: false });

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
            expect(prisma.manager.update).toHaveBeenCalledWith({
                where: { id: mockId },
                data: { isActive: false },
            });
        });

        it('should return 403 if not authorized', async () => {
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);
            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(403);
        });
    });
});
