/**
 * @jest-environment node
 */
import { GET } from '@/app/api/dispatch/foremen/route';
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

describe('/api/dispatch/foremen', () => {
    const mockSession = { user: { id: 'user-1', role: 'manager' } };
    const mockForeman = { id: 'foreman-1', displayName: 'Foreman A', role: 'foreman1' };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    it('should fetch foremen successfully', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValue([mockForeman]);

        const res = await GET();
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual([mockForeman]);
        expect(prisma.user.findMany).toHaveBeenCalledWith({
            where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
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
