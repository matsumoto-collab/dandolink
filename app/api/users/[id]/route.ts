import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { canManageUsers } from '@/utils/permissions';

/**
 * Get a specific user
 * GET /api/users/[id]
 */
export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        if (!canManageUsers(session.user)) {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const user = await prisma.user.findUnique({
            where: { id: params.id },
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
        });

        if (!user) {
            return NextResponse.json(
                { error: 'ユーザーが見つかりません' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            ...user,
            role: user.role.toLowerCase(),
            assignedProjects: user.assignedProjects
                ? JSON.parse(user.assignedProjects)
                : undefined,
        });
    } catch (error) {
        console.error('Get user error:', error);
        return NextResponse.json(
            { error: 'ユーザーの取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Update a user
 * PATCH /api/users/[id]
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        if (!canManageUsers(session.user)) {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const body = await req.json();
        const { email, displayName, password, role, assignedProjects, isActive } = body;

        // Build update data
        const updateData: any = {};

        if (email !== undefined) updateData.email = email;
        if (displayName !== undefined) updateData.displayName = displayName;
        if (role !== undefined) updateData.role = role.toUpperCase();
        if (isActive !== undefined) updateData.isActive = isActive;
        if (assignedProjects !== undefined) {
            updateData.assignedProjects = assignedProjects
                ? JSON.stringify(assignedProjects)
                : null;
        }
        if (password) {
            updateData.passwordHash = await bcrypt.hash(password, 10);
        }

        const updatedUser = await prisma.user.update({
            where: { id: params.id },
            data: updateData,
        });

        return NextResponse.json({
            id: updatedUser.id,
            username: updatedUser.username,
            email: updatedUser.email,
            displayName: updatedUser.displayName,
            role: updatedUser.role.toLowerCase(),
            assignedProjects: updatedUser.assignedProjects
                ? JSON.parse(updatedUser.assignedProjects)
                : undefined,
            isActive: updatedUser.isActive,
            createdAt: updatedUser.createdAt,
            updatedAt: updatedUser.updatedAt,
        });
    } catch (error) {
        console.error('Update user error:', error);
        return NextResponse.json(
            { error: 'ユーザーの更新に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Delete a user
 * DELETE /api/users/[id]
 */
export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        if (!canManageUsers(session.user)) {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        // Prevent deleting yourself
        if (session.user.id === params.id) {
            return NextResponse.json(
                { error: '自分自身を削除することはできません' },
                { status: 400 }
            );
        }

        await prisma.user.delete({
            where: { id: params.id },
        });

        return NextResponse.json({ message: 'ユーザーを削除しました' });
    } catch (error) {
        console.error('Delete user error:', error);
        return NextResponse.json(
            { error: 'ユーザーの削除に失敗しました' },
            { status: 500 }
        );
    }
}
