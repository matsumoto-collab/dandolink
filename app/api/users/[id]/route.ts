import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { canManageUsers } from '@/utils/permissions';
import { updateUserSchema, validateRequest } from '@/lib/validations';
import { requireAuth, parseJsonField, stringifyJsonField, errorResponse, notFoundResponse, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext {
    params: Promise<{ id: string }>;
}

function formatUser(user: { role: string; assignedProjects: string | null; hourlyRate?: unknown;[key: string]: unknown }) {
    return { ...user, role: user.role.toLowerCase(), assignedProjects: parseJsonField<string[]>(user.assignedProjects, []), hourlyRate: user.hourlyRate ? Number(user.hourlyRate) : null };
}

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canManageUsers(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const user = await prisma.user.findUnique({
            where: { id },
            select: { id: true, username: true, email: true, displayName: true, role: true, assignedProjects: true, isActive: true, hourlyRate: true, createdAt: true, updatedAt: true },
        });

        if (!user) return notFoundResponse('ユーザー');
        return NextResponse.json(formatUser(user));
    } catch (error) {
        return serverErrorResponse('ユーザーの取得', error);
    }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canManageUsers(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await req.json();

        const validation = validateRequest(updateUserSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);

        const { email, displayName, password, role, assignedProjects, isActive, hourlyRate } = validation.data;

        const updateData: Record<string, unknown> = {};
        if (email !== undefined) updateData.email = email;
        if (displayName !== undefined) updateData.displayName = displayName;
        if (role !== undefined) updateData.role = role.toUpperCase();
        if (isActive !== undefined) updateData.isActive = isActive;
        if (assignedProjects !== undefined) updateData.assignedProjects = stringifyJsonField(assignedProjects);
        if (hourlyRate !== undefined) updateData.hourlyRate = hourlyRate;
        if (password) updateData.passwordHash = await bcrypt.hash(password, 10);

        const updatedUser = await prisma.user.update({ where: { id }, data: updateData });
        return NextResponse.json(formatUser(updatedUser));
    } catch (error) {
        return serverErrorResponse('ユーザーの更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canManageUsers(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        if (session!.user.id === id) return errorResponse('自分自身を削除することはできません', 400);

        await prisma.user.delete({ where: { id } });
        return NextResponse.json({ message: 'ユーザーを削除しました' });
    } catch (error) {
        return serverErrorResponse('ユーザーの削除', error);
    }
}
