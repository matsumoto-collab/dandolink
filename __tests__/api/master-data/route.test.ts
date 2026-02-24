/**
 * @jest-environment node
 */
import { GET } from '@/app/api/master-data/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        vehicle: { findMany: jest.fn() },
        worker: { findMany: jest.fn() },
        systemSettings: { findFirst: jest.fn() },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/master-data', () => {
    const mockSession = { user: { id: 'u1' } };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    it('should return all master data', async () => {
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([{ id: 'v1' }]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([{ id: 'w1' }]);
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ totalMembers: 5 });

        const res = await GET();

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({
            vehicles: [{ id: 'v1' }],
            workers: [{ id: 'w1' }],
            totalMembers: 5,
        });
    });

    it('should return default totalMembers if settings not found', async () => {
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.worker.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null);

        const res = await GET();

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.totalMembers).toBe(20); // Default value
    });

    it('should return 401 if unauthorized', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });

        const res = await GET();
        expect(res.status).toBe(401);
    });

    it('should return 500 on db error (Promise.all failure)', async () => {
        (prisma.vehicle.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

        const res = await GET();
        expect(res.status).toBe(500);
    });
});
