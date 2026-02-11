/**
 * @jest-environment node
 */
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
}));

describe('lib/auth', () => {
    // Extract the authorize function from the CredentialsProvider
    const providers = authOptions.providers;
    const credentialsProvider = providers.find((p: any) => p.id === 'credentials' || p.options?.name === 'Credentials');
    // In NextAuth v4, provider is an object. usage depends on structure.
    // Usually it's providers: [ CredentialsProvider({...}) ]
    // The authorize function is hidden inside.
    // We can cast to any to access it for testing purposes.
    const authorize = (credentialsProvider as any).options.authorize;

    const mockUser = {
        id: 'user-1',
        username: 'testuser',
        passwordHash: 'hashed_password',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'ADMIN',
        isActive: true,
        assignedProjects: '["proj-1"]',
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return user object on successful authorization', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const result = await authorize({ username: 'testuser', password: 'password' });

        expect(result).toEqual({
            id: 'user-1',
            username: 'testuser',
            email: 'test@example.com',
            displayName: 'Test User',
            role: 'admin',
            assignedProjects: ['proj-1'],
            isActive: true,
        });
    });

    it('should throw error if user not found', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(authorize({ username: 'unknown', password: 'password' }))
            .rejects.toThrow('ユーザー名またはパスワードが正しくありません');
    });

    it('should throw error if password invalid', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(authorize({ username: 'testuser', password: 'wrongpassword' }))
            .rejects.toThrow('ユーザー名またはパスワードが正しくありません');
    });

    it('should throw error if account inactive', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, isActive: false });

        await expect(authorize({ username: 'testuser', password: 'password' }))
            .rejects.toThrow('このアカウントは無効化されています');
    });

    it('should throw error if credentials missing', async () => {
        await expect(authorize({}))
            .rejects.toThrow('ユーザー名とパスワードを入力してください');
    });

    it('should handle invalid JSON in assignedProjects', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...mockUser, assignedProjects: 'invalid-json' });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const result = await authorize({ username: 'testuser', password: 'password' });
        expect(result.assignedProjects).toBeUndefined();
    });
});
