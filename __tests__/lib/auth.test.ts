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

    describe('callbacks', () => {
        const { jwt, session } = authOptions.callbacks as any;

        describe('jwt', () => {
            it('初回ログイン時はuserの情報をtokenにセットする', async () => {
                const token = {};
                const user = {
                    id: '1',
                    username: 'test',
                    role: 'admin',
                    assignedProjects: ['p1'],
                    isActive: true,
                };

                const result = await jwt({ token, user });

                expect(result.id).toBe('1');
                expect(result.username).toBe('test');
                expect(result.role).toBe('admin');
                expect(result.assignedProjects).toEqual(['p1']);
                expect(result.isActive).toBe(true);
                expect(result.lastDbCheck).toBeDefined();
            });

            it('DBチェックの時間が経過していない場合はそのまま返す', async () => {
                const token = {
                    id: '1',
                    lastDbCheck: Date.now() - 1000,
                };

                const result = await jwt({ token });

                expect(prisma.user.findUnique).not.toHaveBeenCalled();
                expect(result).toBe(token);
            });

            it('DBチェック時間が経過し、ユーザーが無効な場合はisActiveをfalseにする', async () => {
                const token = {
                    id: '1',
                    lastDbCheck: Date.now() - 400000,
                    isActive: true,
                };
                (prisma.user.findUnique as jest.Mock).mockResolvedValue({ isActive: false });

                const result = await jwt({ token });

                expect(prisma.user.findUnique).toHaveBeenCalledWith({
                    where: { id: '1' },
                    select: { isActive: true, role: true },
                });
                expect(result.isActive).toBe(false);
            });

            it('DBチェック時間が経過し、ユーザーが有効な場合は情報を更新する', async () => {
                 const token = {
                    id: '1',
                    lastDbCheck: Date.now() - 400000,
                    isActive: true,
                    role: 'user',
                };
                const oldCheck = token.lastDbCheck;
                (prisma.user.findUnique as jest.Mock).mockResolvedValue({ isActive: true, role: 'ADMIN' });

                const result = await jwt({ token });

                expect(result.isActive).toBe(true);
                expect(result.role).toBe('admin');
                expect(result.lastDbCheck).toBeGreaterThan(oldCheck);
            });

            it('DBチェックでエラーが発生した場合は既存のトークン状態を維持する', async () => {
                const token = {
                    id: '1',
                    lastDbCheck: Date.now() - 400000,
                    isActive: true,
                };
                (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));

                const result = await jwt({ token });

                expect(result.isActive).toBe(true); // 維持される
            });
        });

        describe('session', () => {
            it('tokenの情報をsession.userにセットする', async () => {
                const sessionInput = { user: {} };
                const token = {
                    id: '1',
                    username: 'test',
                    role: 'admin',
                    assignedProjects: ['p1'],
                    isActive: true,
                };

                const result = await session({ session: sessionInput, token });

                expect(result.user.id).toBe('1');
                expect(result.user.username).toBe('test');
                expect(result.user.role).toBe('admin');
                expect(result.user.assignedProjects).toEqual(['p1']);
                expect(result.user.isActive).toBe(true);
            });
        });
    });
});
