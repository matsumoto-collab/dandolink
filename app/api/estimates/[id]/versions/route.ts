import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;

        const versions = await prisma.estimateVersion.findMany({
            where: { estimateId: id },
            orderBy: { versionNumber: 'desc' },
            select: {
                id: true,
                versionNumber: true,
                estimateNumber: true,
                title: true,
                total: true,
                status: true,
                createdAt: true,
                createdBy: true,
            },
        });

        const userIds = Array.from(new Set(versions.map(v => v.createdBy).filter((v): v is string => !!v)));
        const users = userIds.length > 0
            ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })
            : [];
        const userMap = new Map(users.map(u => [u.id, u.displayName]));

        const result = versions.map(v => ({
            id: v.id,
            versionNumber: v.versionNumber,
            estimateNumber: v.estimateNumber,
            title: v.title,
            total: Number(v.total),
            status: v.status,
            createdAt: v.createdAt.toISOString(),
            createdBy: v.createdBy,
            createdByName: v.createdBy ? (userMap.get(v.createdBy) ?? null) : null,
        }));

        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('見積履歴一覧の取得', error);
    }
}
