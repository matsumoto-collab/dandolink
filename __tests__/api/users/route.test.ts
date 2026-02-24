/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/users/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { canManageUsers } from '@/utils/permissions';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

jest.mock('bcryptjs', () => ({
    hash: jest.fn().mockResolvedValue('hashed_password'),
}));

describe('/api/users', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'admin', isActive: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
        (canManageUsers as jest.Mock).mockReturnValue(true);
    });

    describe('GET', () => {
        it('should return users list', async () => {
            const mockUsers = [
                { id: '1', username: 'user1', role: 'MANAGER', assignedProjects: '[]', createdAt: new Date() },
            ];
            (prisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);

            const req = new NextRequest('http://localhost:3000/api/users');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toHaveLength(1);
            expect(json[0].role).toBe('manager'); // Lowercase conversion check
        });

        it('should return masked data if not admin or manager', async () => {
            const mockSessionWorker = {
                user: { id: 'user-2', role: 'worker', isActive: true },
            };
            (requireAuth as jest.Mock).mockResolvedValue({ session: mockSessionWorker, error: null });

            const mockUsers = [
                { id: '1', username: 'user1', email: 'test@example.com', displayName: 'Test User', role: 'MANAGER', assignedProjects: '[]', hourlyRate: 1500, createdAt: new Date() },
            ];
            (prisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);

            const req = new NextRequest('http://localhost:3000/api/users');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toHaveLength(1);

            // Masked data check
            expect(json[0].id).toBe('1');
            expect(json[0].displayName).toBe('Test User');
            expect(json[0].role).toBe('manager');
            expect(json[0].email).toBeUndefined();
            expect(json[0].username).toBeUndefined();
            expect(json[0].hourlyRate).toBeUndefined();
        });
    });

    describe('POST', () => {
        const validBody = {
            username: 'newuser',
            email: 'new@example.com',
            displayName: 'New User',
            password: 'password123',
            role: 'manager',
            assignedProjects: [],
            passwordConfirm: 'password123'
        };

        it('should create a user', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null); // No duplicates
            const createdUser = {
                id: 'new-1',
                ...validBody,
                passwordHash: 'hashed_password',
                role: 'MANAGER',
                assignedProjects: '[]',
                createdAt: new Date(),
                updatedAt: new Date(),
                isActive: true
            };
            (prisma.user.create as jest.Mock).mockResolvedValue(createdUser);

            const req = new NextRequest('http://localhost:3000/api/users', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(prisma.user.create).toHaveBeenCalled();
            expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
        });

        it('should return 400 validation error', async () => {
            const invalidBody = { ...validBody, username: undefined };

            const req = new NextRequest('http://localhost:3000/api/users', {
                method: 'POST',
                body: JSON.stringify(invalidBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(400);
        });

        it('should return 400 if username exists', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });

            const req = new NextRequest('http://localhost:3000/api/users', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(400); // Username exists
        });
    });
});
