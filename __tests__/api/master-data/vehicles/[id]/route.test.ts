/**
 * @jest-environment node
 */
import { PATCH, DELETE } from '@/app/api/master-data/vehicles/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, validateStringField, errorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        vehicle: {
            update: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    validateStringField: jest.fn(),
}));

jest.mock('@/utils/permissions', () => ({
    isManagerOrAbove: jest.fn(),
}));

describe('/api/master-data/vehicles/[id]', () => {
    const mockSession = { user: { id: 'u1', role: 'manager' } };
    const mockId = 'v1';
    const context = { params: Promise.resolve({ id: mockId }) };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (isManagerOrAbove as jest.Mock).mockReturnValue(true);
        (validateStringField as jest.Mock).mockImplementation((val) => val);
    });

    describe('PATCH', () => {
        const req = (body: any) => new NextRequest(`http://localhost:3000/api/master-data/vehicles/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });

        it('should update vehicle name', async () => {
            (prisma.vehicle.update as jest.Mock).mockResolvedValue({ id: mockId, name: 'Updated' });

            const res = await PATCH(req({ name: 'Updated' }), context);

            expect(res.status).toBe(200);
            expect(prisma.vehicle.update).toHaveBeenCalledWith({ where: { id: mockId }, data: { name: 'Updated' } });
        });

        it('should return 400 on validation error', async () => {
            (validateStringField as jest.Mock).mockReturnValue(NextResponse.json({ error: 'Invalid' }, { status: 400 }));
            const res = await PATCH(req({ name: '' }), context);
            expect(res.status).toBe(400);
        });

        it('should return 403 if not manager', async () => {
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);
            const res = await PATCH(req({ name: 'Updated' }), context);
            expect(res.status).toBe(403);
        });

        it('should return 401 if unauthorized', async () => {
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
            const res = await PATCH(req({ name: 'Updated' }), context);
            expect(res.status).toBe(401);
        });

        it('should return 500 on db error', async () => {
            (prisma.vehicle.update as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const res = await PATCH(req({ name: 'Updated' }), context);
            expect(res.status).toBe(500);
        });
    });

    describe('DELETE', () => {
        const req = () => new NextRequest(`http://localhost:3000/api/master-data/vehicles/${mockId}`, { method: 'DELETE' });

        it('should logical delete vehicle', async () => {
            (prisma.vehicle.update as jest.Mock).mockResolvedValue({ id: mockId, isActive: false });

            const res = await DELETE(req(), context);

            expect(res.status).toBe(200);
            expect(prisma.vehicle.update).toHaveBeenCalledWith({ where: { id: mockId }, data: { isActive: false } });
        });

        it('should return 403 if not manager', async () => {
            (isManagerOrAbove as jest.Mock).mockReturnValue(false);
            const res = await DELETE(req(), context);
            expect(res.status).toBe(403);
        });

        it('should return 401 if unauthorized', async () => {
            (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
            const res = await DELETE(req(), context);
            expect(res.status).toBe(401);
        });

        it('should return 500 on db error', async () => {
            (prisma.vehicle.update as jest.Mock).mockRejectedValue(new Error('DB Error'));
            const res = await DELETE(req(), context);
            expect(res.status).toBe(500);
        });
    });
});
