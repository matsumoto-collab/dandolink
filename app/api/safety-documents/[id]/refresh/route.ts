import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    notFoundResponse,
} from '@/lib/api/utils';
import { refreshMeiboWorkerSnapshots } from '@/lib/api/safetySnapshot';
import type { SagyoinMeiboData } from '@/lib/safetyDocuments';

interface RouteContext { params: Promise<{ id: string }>; }

/**
 * スナップショットの最新化（FR-4-3:「マスターの最新値で更新」ボタン）。
 * 取得できた対象は現在値で更新、マスターから消えた対象は既存スナップショット据え置き。
 * レスポンスの notFoundKeys でフロントが「更新できなかった対象」を警告表示できる。
 */
export async function POST(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const existing = await prisma.safetyDocument.findFirst({
            where: { id, deletedAt: null },
        });
        if (!existing) return notFoundResponse('安全書類');

        const currentData = existing.data as unknown as SagyoinMeiboData;
        const { snapshots, notFoundKeys } = await refreshMeiboWorkerSnapshots(currentData.workers);

        const data: SagyoinMeiboData = { header: currentData.header, workers: snapshots };

        const document = await prisma.safetyDocument.update({
            where: { id },
            data: { data: data as unknown as Prisma.InputJsonValue },
            include: { projectMaster: { select: { id: true, title: true } } },
        });

        return NextResponse.json(
            { document, notFoundKeys },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('安全書類スナップショット更新', error);
    }
}
