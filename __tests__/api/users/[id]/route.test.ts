/**
 * @jest-environment node
 */
import { GET, PATCH, DELETE } from '@/app/api/users/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canManageUsers } from '@/utils/permissions';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
    },
}));

jest.mock('bcryptjs', () => ({
    hash: jest.fn(),
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    parseJsonField: (val: any) => val,
    stringifyJsonField: (val: any) => JSON.stringify(val),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    validationErrorResponse: jest.fn().mockImplementation((msg, details) => NextResponse.json({ error: msg, details }, { status: 400 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
}));

jest.mock('@/utils/permissions', () => ({
    canManageUsers: jest.fn(),
}));

describe('/api/users/[id]', () => {
    const mockSession = { user: { id: 'admin-1', role: 'admin' } };
    const mockId = 'user-1';
    const mockUser = {
        id: mockId,
        username: 'testuser',
        email: 'test@example.com',
        role: 'USER',
        assignedProjects: '[]',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canManageUsers as jest.Mock).mockReturnValue(true);
        (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
    });

    describe('GET', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/users/${mockId}`);
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should fetch user successfully', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

            const res = await GET(createReq(), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.username).toBe(mockUser.username);
        });

        it('should return 403 if not authorized', async () => {
            (canManageUsers as jest.Mock).mockReturnValue(false);
            const res = await GET(createReq(), context);
            expect(res.status).toBe(403);
        });

        it('should return 404 if user not found', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await GET(createReq(), context);
            expect(res.status).toBe(404);
        });
    });

    describe('PATCH', () => {
        const updateBody = {
            displayName: 'Updated Name',
            role: 'manager',
            password: 'NewPassword1',
        };
        const createReq = (body: any) => new NextRequest(`http://localhost:3000/api/users/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should update user successfully', async () => {
            (prisma.user.update as jest.Mock).mockResolvedValue({ ...mockUser, ...updateBody, role: 'MANAGER' });

            const res = await PATCH(createReq(updateBody), context);
            await res.json();

            expect(res.status).toBe(200);
            expect(bcrypt.hash).toHaveBeenCalledWith('NewPassword1', 10);
            expect(prisma.user.update).toHaveBeenCalled();
        });

        it('should return 400 on validation error', async () => {
            const invalidBody = { email: 'invalid-email' };
            const res = await PATCH(createReq(invalidBody), context);
            expect(res.status).toBe(400);
        });

        it('should return 403 if not authorized', async () => {
            (canManageUsers as jest.Mock).mockReturnValue(false);
            const res = await PATCH(createReq(updateBody), context);
            expect(res.status).toBe(403);
        });
    });

    describe('DELETE', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/users/${mockId}`, { method: 'DELETE' });
        const context = { params: Promise.resolve({ id: mockId }) };

        it('should delete user successfully', async () => {
            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
            expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: mockId } });
        });

        it('should return 400 if deleting self', async () => {
            (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: mockId } }, error: null });
            // need to mock canManageUsers as well since it uses session user
            (canManageUsers as jest.Mock).mockReturnValue(true);

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(400);
            expect(prisma.user.delete).not.toHaveBeenCalled();
        });

        it('should return 403 if not authorized', async () => {
            (canManageUsers as jest.Mock).mockReturnValue(false);
            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(403);
        });
    });
});
