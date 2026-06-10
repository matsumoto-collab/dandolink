import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { canManageUsers } from '@/utils/permissions';
import { updateUserSchema, validateRequest } from '@/lib/validations';
import { requireAuth, parseJsonField, stringifyJsonField, errorResponse, notFoundResponse, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext {
    params: Promise<{ id: string }>;
}

function formatUser(user: { role: string; assignedProjects: string | null; dailyRate?: unknown;[key: string]: unknown }) {
    return { ...user, role: user.role.toLowerCase(), assignedProjects: parseJsonField<string[]>(user.assignedProjects, []), dailyRate: user.dailyRate ? Number(user.dailyRate) : null };
}

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canManageUsers(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const user = await prisma.user.findUnique({
            where: { id },
            select: { id: true, username: true, email: true, displayName: true, role: true, assignedProjects: true, isActive: true, dailyRate: true, companyId: true, isLoginEnabled: true, partnerTaxMode: true, createdAt: true, updatedAt: true },
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

        const { email, displayName, password, role, assignedProjects, isActive, dailyRate, companyId, isLoginEnabled, partnerTaxMode } = validation.data;

        // role / companyId 変更時の親role検証
        if (role === 'partner_member' || companyId !== undefined) {
            const existing = await prisma.user.findUnique({ where: { id }, select: { role: true, companyId: true } });
            if (!existing) return notFoundResponse('ユーザー');
            const nextRole = (role ?? existing.role.toLowerCase()).toLowerCase();
            const nextCompanyId = companyId !== undefined ? companyId : existing.companyId;
            if (nextRole === 'partner_member') {
                if (!nextCompanyId) return errorResponse('partner_memberにはcompanyIdが必須です', 400);
                const parent = await prisma.user.findUnique({ where: { id: nextCompanyId }, select: { role: true } });
                if (!parent) return errorResponse('指定された協力会社が存在しません', 400);
                if (parent.role !== 'PARTNER') return errorResponse('指定されたユーザーは協力会社ではありません', 400);
            }
        }

        const updateData: Record<string, unknown> = {};
        if (email !== undefined) updateData.email = email;
        if (displayName !== undefined) updateData.displayName = displayName;
        if (role !== undefined) updateData.role = role.toUpperCase();
        if (isActive !== undefined) updateData.isActive = isActive;
        if (assignedProjects !== undefined) updateData.assignedProjects = stringifyJsonField(assignedProjects);
        if (dailyRate !== undefined) updateData.dailyRate = dailyRate;
        if (companyId !== undefined) updateData.companyId = companyId;
        if (isLoginEnabled !== undefined) updateData.isLoginEnabled = isLoginEnabled;
        if (partnerTaxMode !== undefined) updateData.partnerTaxMode = partnerTaxMode;
        if (password) updateData.passwordHash = await bcrypt.hash(password, 10);

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: { id: true, username: true, email: true, displayName: true, role: true, assignedProjects: true, isActive: true, dailyRate: true, companyId: true, isLoginEnabled: true, partnerTaxMode: true, createdAt: true, updatedAt: true },
        });
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

        // 親協力会社削除ガード: メンバーが残っている場合は削除拒否
        const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
        if (!target) return notFoundResponse('ユーザー');
        // DBのrole生値は大小文字が経路依存のため必ず正規化して比較する（教訓: PARTNER取りこぼし事故）
        if (target.role.toUpperCase() === 'PARTNER') {
            const memberCount = await prisma.user.count({ where: { companyId: id } });
            if (memberCount > 0) {
                return errorResponse(`所属メンバーが${memberCount}名残っているため削除できません。先にメンバーを削除してください。`, 400);
            }
        }

        await prisma.user.delete({ where: { id } });
        return NextResponse.json({ message: 'ユーザーを削除しました' });
    } catch (error) {
        return serverErrorResponse('ユーザーの削除', error);
    }
}
