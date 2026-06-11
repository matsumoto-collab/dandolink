import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
    notFoundResponse,
    deleteSuccessResponse,
} from '@/lib/api/utils';
import { safetyDocumentUpdateSchema } from '@/lib/validations/safety';
import { mergeMeiboWorkerSnapshots } from '@/lib/api/safetySnapshot';
import type { SagyoinMeiboData } from '@/lib/safetyDocuments';

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const document = await prisma.safetyDocument.findFirst({
            where: { id, deletedAt: null },
            include: { projectMaster: { select: { id: true, title: true } } },
        });
        if (!document) return notFoundResponse('安全書類');

        return NextResponse.json(document, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('安全書類取得', error);
    }
}

export async function PUT(request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const existing = await prisma.safetyDocument.findFirst({
            where: { id, deletedAt: null },
        });
        if (!existing) return notFoundResponse('安全書類');

        const body = await request.json();
        const parsed = safetyDocumentUpdateSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }
        const { projectId, title, header, members } = parsed.data;

        if (projectId) {
            const project = await prisma.projectMaster.findUnique({
                where: { id: projectId },
                select: { id: true },
            });
            if (!project) return validationErrorResponse('指定された案件が見つかりません');
        }

        const currentData = existing.data as unknown as SagyoinMeiboData;

        // メンバー変更: 既存メンバーのスナップショットは据え置き、新規のみ現在値で取得（FR-4-2）
        let workers = currentData.workers;
        if (members) {
            const { snapshots, notFoundKeys } = await mergeMeiboWorkerSnapshots(currentData.workers, members);
            if (notFoundKeys.length > 0) {
                return validationErrorResponse(`選択した作業員が見つかりません: ${notFoundKeys.join(', ')}`);
            }
            workers = snapshots;
        }

        const data: SagyoinMeiboData = {
            header: header ?? currentData.header,
            workers,
        };

        const document = await prisma.safetyDocument.update({
            where: { id },
            data: {
                ...(title !== undefined ? { title } : {}),
                ...(projectId !== undefined ? { projectId } : {}),
                data: data as unknown as Prisma.InputJsonValue,
            },
            include: { projectMaster: { select: { id: true, title: true } } },
        });

        return NextResponse.json(document, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('安全書類更新', error);
    }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        // 論理削除のみ（FR-2-5。物理削除機能は設けない — 5年保存要件）
        const result = await prisma.safetyDocument.updateMany({
            where: { id, deletedAt: null },
            data: { deletedAt: new Date() },
        });
        if (result.count === 0) return notFoundResponse('安全書類');

        return deleteSuccessResponse('安全書類');
    } catch (error) {
        return serverErrorResponse('安全書類削除', error);
    }
}
