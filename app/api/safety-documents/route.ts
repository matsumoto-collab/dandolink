import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { safetyDocumentCreateSchema } from '@/lib/validations/safety';
import {
    buildMachineSnapshots,
    buildMeiboWorkerSnapshots,
    buildTodokeVehicleSnapshots,
} from '@/lib/api/safetySnapshot';
import type { SafetyDocumentData } from '@/lib/safetyDocuments';

/**
 * 安全書類 API（安全書類 Phase 1）。admin / manager のみ。
 *
 * GET  /api/safety-documents?projectId=&type=&q= … 一覧（論理削除済みは返さない）
 * POST /api/safety-documents                     … 作成。data（スナップショット）はサーバーが
 *                                                  現在のマスター値から生成する（FR-4-1）
 */

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const projectId = searchParams.get('projectId');
        const type = searchParams.get('type');
        const q = searchParams.get('q');

        const documents = await prisma.safetyDocument.findMany({
            where: {
                deletedAt: null,
                ...(projectId ? { projectId } : {}),
                ...(type ? { type } : {}),
                ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
            },
            include: { projectMaster: { select: { id: true, title: true } } },
            orderBy: { createdAt: 'desc' },
            take: 500,
        });

        return NextResponse.json(documents, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('安全書類一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const parsed = safetyDocumentCreateSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }

        const input = parsed.data;

        if (input.projectId) {
            const project = await prisma.projectMaster.findUnique({
                where: { id: input.projectId },
                select: { id: true },
            });
            if (!project) return validationErrorResponse('指定された案件が見つかりません');
        }

        // 書類種別ごとに現在のマスター値からスナップショットを生成（FR-4-1）
        let data: SafetyDocumentData;
        if (input.type === 'sagyoin_meibo') {
            const { snapshots, notFoundKeys } = await buildMeiboWorkerSnapshots(input.members);
            if (notFoundKeys.length > 0) {
                return validationErrorResponse(`選択した作業員が見つかりません: ${notFoundKeys.join(', ')}`);
            }
            data = { header: input.header, workers: snapshots };
        } else if (input.type === 'vehicle_todoke') {
            const { snapshots, notFoundKeys } = await buildTodokeVehicleSnapshots(input.vehicles);
            if (notFoundKeys.length > 0) {
                return validationErrorResponse(`選択した車両が見つかりません: ${notFoundKeys.join(', ')}`);
            }
            data = {
                header: input.header,
                periodFrom: input.periodFrom ?? null,
                periodTo: input.periodTo ?? null,
                vehicles: snapshots,
            };
        } else {
            const { snapshots, notFoundKeys } = await buildMachineSnapshots(input.machines);
            if (notFoundKeys.length > 0) {
                return validationErrorResponse(`選択した機械が見つかりません: ${notFoundKeys.join(', ')}`);
            }
            data = {
                header: input.header,
                periodFrom: input.periodFrom ?? null,
                periodTo: input.periodTo ?? null,
                machines: snapshots,
            };
        }

        const document = await prisma.safetyDocument.create({
            data: {
                type: input.type,
                projectId: input.projectId ?? null,
                title: input.title,
                data: data as unknown as Prisma.InputJsonValue,
                createdBy: session!.user.id,
            },
            include: { projectMaster: { select: { id: true, title: true } } },
        });

        return NextResponse.json(document, { status: 201 });
    } catch (error) {
        return serverErrorResponse('安全書類作成', error);
    }
}
