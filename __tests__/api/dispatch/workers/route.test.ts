/**
 * @jest-environment node
 */
import { GET } from '@/app/api/dispatch/workers/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findMany: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

describe('/api/dispatch/workers', () => {
    const mockSession = { user: { id: 'user-1', role: 'manager' } };
    const mockWorker = { id: 'worker-1', displayName: 'Worker A', role: 'worker' };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    it('should fetch workers successfully', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValue([mockWorker]);

        const res = await GET();
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual([mockWorker]);
        expect(prisma.user.findMany).toHaveBeenCalledWith({
            where: { isActive: true, role: { in: ['worker', 'WORKER', 'foreman2', 'FOREMAN2', 'foreman1', 'FOREMAN1', 'admin', 'ADMIN', 'manager', 'MANAGER'] } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });
    });

    it('should return 403 if role is not allowed', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { role: 'guest' } }, error: null });
        const res = await GET();
        expect(res.status).toBe(403);
    });
});
