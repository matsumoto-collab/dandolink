/**
 * @jest-environment node
 */
import { GET } from '@/app/api/dispatch/foremen/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

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

const makeReq = (url: string) => ({ url } as NextRequest);
const allRoles = ['foreman1', 'foreman2', 'admin', 'manager', 'partner'];
const rolesWithoutPartner = ['foreman1', 'foreman2', 'admin', 'manager'];

describe('/api/dispatch/foremen', () => {
    const mockSession = { user: { id: 'user-1', role: 'manager' } };
    const mockForeman = { id: 'foreman-1', displayName: 'Foreman A', role: 'foreman1' };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    it('should fetch foremen successfully (no scope, manager)', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValue([mockForeman]);

        const res = await GET(makeReq('http://localhost/api/dispatch/foremen'));
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json).toEqual([mockForeman]);
        expect(prisma.user.findMany).toHaveBeenCalledWith({
            where: { isActive: true, role: { in: allRoles, mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });
    });

    it('should return 403 if role is not allowed', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { role: 'guest' } }, error: null });
        const res = await GET(makeReq('http://localhost/api/dispatch/foremen'));
        expect(res.status).toBe(403);
    });

    it('scope=schedule + foreman2: should exclude partner from role filter', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'foreman2' } }, error: null });
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

        await GET(makeReq('http://localhost/api/dispatch/foremen?scope=schedule'));

        expect(prisma.user.findMany).toHaveBeenCalledWith({
            where: { isActive: true, role: { in: rolesWithoutPartner, mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });
    });

    it('scope=schedule + foreman1: should include partner (foreman1 unaffected)', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'foreman1' } }, error: null });
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

        await GET(makeReq('http://localhost/api/dispatch/foremen?scope=schedule'));

        expect(prisma.user.findMany).toHaveBeenCalledWith({
            where: { isActive: true, role: { in: allRoles, mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });
    });

    it('scope=schedule + admin: should include partner', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'admin' } }, error: null });
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

        await GET(makeReq('http://localhost/api/dispatch/foremen?scope=schedule'));

        expect(prisma.user.findMany).toHaveBeenCalledWith({
            where: { isActive: true, role: { in: allRoles, mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });
    });

    it('no scope + foreman2: should include partner (attendance/materials unaffected)', async () => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'foreman2' } }, error: null });
        (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

        await GET(makeReq('http://localhost/api/dispatch/foremen'));

        expect(prisma.user.findMany).toHaveBeenCalledWith({
            where: { isActive: true, role: { in: allRoles, mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });
    });
});
