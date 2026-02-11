/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/master-data/vehicles/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, validateStringField } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        vehicle: {
            findMany: jest.fn(),
            create: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    validateStringField: jest.fn(),
}));

describe('/api/master-data/vehicles', () => {
    const mockSession = { user: { id: 'u1' } };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (validateStringField as jest.Mock).mockImplementation((val) => val);
    });

    describe('GET', () => {
        it('should return active vehicles', async () => {
            (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([{ id: 'v1', name: 'Vehicle 1' }]);

            const res = await GET();

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual([{ id: 'v1', name: 'Vehicle 1' }]);
            expect(prisma.vehicle.findMany).toHaveBeenCalledWith({ where: { isActive: true }, orderBy: { name: 'asc' } });
        });

        it('should return 401 if unauthorized', async () => {
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
            const res = await GET();
            expect(res.status).toBe(401);
        });

        it('should return 500 on db error', async () => {
            (prisma.vehicle.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const res = await GET();
            expect(res.status).toBe(500);
        });
    });

    describe('POST', () => {
        const postReq = (body: any) => new NextRequest('http://localhost:3000/api/master-data/vehicles', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        it('should create a vehicle', async () => {
            (prisma.vehicle.create as jest.Mock).mockResolvedValue({ id: 'v1', name: 'New Vehicle' });

            const res = await POST(postReq({ name: 'New Vehicle' }));

            expect(res.status).toBe(201);
            expect(await res.json()).toEqual({ id: 'v1', name: 'New Vehicle' });
        });

        it('should return 400 on validation error', async () => {
            (validateStringField as jest.Mock).mockReturnValue(NextResponse.json({ error: 'Invalid' }, { status: 400 }));

            const res = await POST(postReq({ name: '' }));

            expect(res.status).toBe(400);
            expect(prisma.vehicle.create).not.toHaveBeenCalled();
        });

        it('should return 401 if unauthorized', async () => {
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
            const res = await POST(postReq({ name: 'New Vehicle' }));
            expect(res.status).toBe(401);
        });

        it('should return 500 on db error', async () => {
            (prisma.vehicle.create as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const res = await POST(postReq({ name: 'New Vehicle' }));
            expect(res.status).toBe(500);
        });
    });
});
