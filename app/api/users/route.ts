import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { canManageUsers } from '@/utils/permissions';
import { createUserSchema, validateRequest } from '@/lib/validations';

/**
 * Get all users
 * GET /api/users
 */
export async function GET(_req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        console.log('Session:', JSON.stringify(session, null, 2));

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        console.log('User role:', session.user.role);
        console.log('Can manage users:', canManageUsers(session.user));

        if (!canManageUsers(session.user)) {
            return NextResponse.json({
                error: '権限がありません',
                debug: {
                    role: session.user.role,
                    canManage: canManageUsers(session.user)
                }
            }, { status: 403 });
        }

        const users = await prisma.user.findMany({
            select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                role: true,
                assignedProjects: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Parse assignedProjects JSON
        const parsedUsers = users.map((user) => ({
            ...user,
            role: user.role.toLowerCase(),
            assignedProjects: user.assignedProjects
                ? JSON.parse(user.assignedProjects)
                : undefined,
        }));

        return NextResponse.json(parsedUsers);
    } catch (error) {
        console.error('Get users error:', error);
        return NextResponse.json(
            { error: 'ユーザー一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Create a new user
 * POST /api/users
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        if (!canManageUsers(session.user)) {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const body = await req.json();

        // Zodバリデーション
        const validation = validateRequest(createUserSchema, body);
        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error, details: validation.details },
                { status: 400 }
            );
        }

        const { username, email, displayName, password, role, assignedProjects } = validation.data;

        // Check if username already exists
        const existingUser = await prisma.user.findUnique({
            where: { username },
        });

        if (existingUser) {
            return NextResponse.json(
                { error: 'このユーザー名は既に使用されています' },
                { status: 400 }
            );
        }

        // Check if email already exists
        const existingEmail = await prisma.user.findUnique({
            where: { email },
        });

        if (existingEmail) {
            return NextResponse.json(
                { error: 'このメールアドレスは既に使用されています' },
                { status: 400 }
            );
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const newUser = await prisma.user.create({
            data: {
                username,
                email,
                displayName,
                passwordHash: hashedPassword,
                role: role.toUpperCase(),
                assignedProjects: assignedProjects
                    ? JSON.stringify(assignedProjects)
                    : null,
                isActive: true,
            },
        });

        return NextResponse.json({
            id: newUser.id,
            username: newUser.username,
            email: newUser.email,
            displayName: newUser.displayName,
            role: newUser.role.toLowerCase(),
            assignedProjects: newUser.assignedProjects
                ? JSON.parse(newUser.assignedProjects)
                : undefined,
            isActive: newUser.isActive,
            createdAt: newUser.createdAt,
            updatedAt: newUser.updatedAt,
        });
    } catch (error) {
        console.error('Create user error:', error);
        return NextResponse.json(
            { error: 'ユーザーの作成に失敗しました' },
            { status: 500 }
        );
    }
}

