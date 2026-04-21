import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { z } from 'zod';

const DISPATCH_ROLES = ['worker', 'WORKER', 'foreman2', 'FOREMAN2', 'foreman1', 'FOREMAN1', 'admin', 'ADMIN', 'manager', 'MANAGER', 'support', 'SUPPORT'];

const updateSchema = z.object({
    items: z.array(z.object({
        id: z.string().min(1),
        dispatchSortOrder: z.number().int(),
        hideByDefaultInDispatch: z.boolean(),
    })).min(1),
});

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = (session!.user.role || '').toLowerCase();
        if (!['admin', 'manager'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const users = await prisma.user.findMany({
            where: { isActive: true, role: { in: DISPATCH_ROLES } },
            select: {
                id: true,
                displayName: true,
                role: true,
                dispatchSortOrder: true,
                hideByDefaultInDispatch: true,
            },
            orderBy: [
                { dispatchSortOrder: { sort: 'asc', nulls: 'last' } },
                { displayName: 'asc' },
            ],
        });

        return NextResponse.json(users, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('手配確定並び順取得', error);
    }
}

export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = (session!.user.role || '').toLowerCase();
        if (!['admin', 'manager'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const body = await req.json();
        const parsed = updateSchema.safeParse(body);
        if (!parsed.success) {
            return errorResponse('リクエスト形式が不正です', 400);
        }

        const { items } = parsed.data;

        await prisma.$transaction(
            items.map(item =>
                prisma.user.update({
                    where: { id: item.id },
                    data: {
                        dispatchSortOrder: item.dispatchSortOrder,
                        hideByDefaultInDispatch: item.hideByDefaultInDispatch,
                    },
                })
            )
        );

        return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('手配確定並び順更新', error);
    }
}
