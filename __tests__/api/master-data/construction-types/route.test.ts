/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/master-data/construction-types/route';
import { PATCH, DELETE } from '@/app/api/master-data/construction-types/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        constructionType: {
            findMany: jest.fn(),
            create: jest.fn(),
            createMany: jest.fn(),
            update: jest.fn(),
            aggregate: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    validationErrorResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: msg }, { status: 400 })),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    validateStringField: (val: any) => val,
    validateHexColor: (val: any) => val,
}));

jest.mock('@/utils/permissions', () => ({
    isManagerOrAbove: jest.fn(),
}));

describe('/api/master-data/construction-types', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockType = { id: 'type-1', name: 'Type A', color: '#ffffff', sortOrder: 0, isActive: true };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
    });

    describe('GET', () => {
        it('should fetch active types', async () => {
            (prisma.constructionType.findMany as jest.Mock).mockResolvedValue([mockType]);

            const res = await GET();
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json).toEqual([mockType]);
        });

        it('should seed default types if empty', async () => {
            // First call returns empty, second call returns seeded data
            (prisma.constructionType.findMany as jest.Mock)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([mockType]);

            const res = await GET();

            expect(prisma.constructionType.createMany).toHaveBeenCalled();
            expect(res.status).toBe(200);
        });
    });

    describe('POST', () => {
        const createReq = (body: any) => new NextRequest('http://localhost:3000/api/master-data/construction-types', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        it('should create type successfully', async () => {
            (prisma.constructionType.aggregate as jest.Mock).mockResolvedValue({ _max: { sortOrder: 0 } });
            (prisma.constructionType.create as jest.Mock).mockResolvedValue(mockType);

            const res = await POST(createReq({ name: 'Type A', color: '#ffffff' }));
            const json = await res.json();

            expect(res.status).toBe(201);
            expect(json).toEqual(mockType);
        });
    });
});

describe('/api/master-data/construction-types/[id]', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'type-1';
    const mockType = { id: mockId, name: 'Type A', color: '#ffffff', sortOrder: 0, isActive: true };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
    });

    describe('PATCH', () => {
        const createReq = (body: any) => new NextRequest(`http://localhost:3000/api/master-data/construction-types/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        const context = { params: Promise.resolve({ id: mockId }) }; // Check if Promise or object is needed

        it('should update type successfully', async () => {
            (prisma.constructionType.update as jest.Mock).mockResolvedValue({ ...mockType, name: 'Updated' });

            const res = await PATCH(createReq({ name: 'Updated' }), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.name).toBe('Updated');
        });

        it('should return 400 for invalid name', async () => {
            const res = await PATCH(createReq({ name: '' }), context);
            expect(res.status).toBe(400);
        });

        it('should return 403 if not authorized', async () => {
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);
            const res = await PATCH(createReq({ name: 'Updated' }), context);
            expect(res.status).toBe(403);
        });
    });

    describe('DELETE', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/master-data/construction-types/${mockId}`, { method: 'DELETE' });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should soft delete type successfully', async () => {
            (prisma.constructionType.update as jest.Mock).mockResolvedValue({ ...mockType, isActive: false });

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
            expect(prisma.constructionType.update).toHaveBeenCalledWith({
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
