import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { canManageUsers } from '@/utils/permissions';
import { createUserSchema, validateRequest } from '@/lib/validations';
import { requireAuth, parseJsonField, stringifyJsonField, errorResponse, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

/**
 * GET /api/users - ユーザー一覧取得
 */
export async function GET(_req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canManageUsers(session!.user)) return errorResponse('権限がありません', 403);

        const users = await prisma.user.findMany({
            select: { id: true, username: true, email: true, displayName: true, role: true, assignedProjects: true, isActive: true, createdAt: true, updatedAt: true },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(users.map(user => ({
            ...user,
            role: user.role.toLowerCase(),
            assignedProjects: parseJsonField<string[]>(user.assignedProjects, []),
        })));
    } catch (error) {
        return serverErrorResponse('ユーザー一覧の取得', error);
    }
}

/**
 * POST /api/users - ユーザー作成
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canManageUsers(session!.user)) return errorResponse('権限がありません', 403);

        const body = await req.json();
        const validation = validateRequest(createUserSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const { username, email, displayName, password, role, assignedProjects } = validation.data;

        const existingUser = await prisma.user.findUnique({ where: { username } });
        if (existingUser) return errorResponse('このユーザー名は既に使用されています', 400);

        const existingEmail = await prisma.user.findUnique({ where: { email } });
        if (existingEmail) return errorResponse('このメールアドレスは既に使用されています', 400);

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                username, email, displayName,
                passwordHash: hashedPassword,
                role: role.toUpperCase(),
                assignedProjects: stringifyJsonField(assignedProjects),
                isActive: true,
            },
        });

        return NextResponse.json({
            id: newUser.id, username: newUser.username, email: newUser.email, displayName: newUser.displayName,
            role: newUser.role.toLowerCase(),
            assignedProjects: parseJsonField<string[]>(newUser.assignedProjects, []),
            isActive: newUser.isActive, createdAt: newUser.createdAt, updatedAt: newUser.updatedAt,
        });
    } catch (error) {
        return serverErrorResponse('ユーザーの作成', error);
    }
}
