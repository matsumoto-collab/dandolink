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
import {
    mergeMachineSnapshots,
    mergeMeiboWorkerSnapshots,
    mergeTodokeVehicleSnapshots,
} from '@/lib/api/safetySnapshot';
import type { KikaiTodokeData, SafetyDocumentData, SagyoinMeiboData, VehicleTodokeData } from '@/lib/safetyDocuments';

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
        const input = parsed.data;
        if (input.type !== existing.type) {
            return validationErrorResponse('書類種別は変更できません');
        }
        const { projectId, title, header } = input;

        if (projectId) {
            const project = await prisma.projectMaster.findUnique({
                where: { id: projectId },
                select: { id: true },
            });
            if (!project) return validationErrorResponse('指定された案件が見つかりません');
        }

        // 種別ごとに data を再構築。対象リストは既存スナップショット据え置き・新規のみ現在値（FR-4-2）。
        // 車両の運転者 / 機械の取扱者は書類固有入力のため常に送信値を採用する。
        let data: SafetyDocumentData;
        if (input.type === 'sagyoin_meibo') {
            const currentData = existing.data as unknown as SagyoinMeiboData;
            let workers = currentData.workers;
            if (input.members) {
                const { snapshots, notFoundKeys } = await mergeMeiboWorkerSnapshots(currentData.workers, input.members);
                if (notFoundKeys.length > 0) {
                    return validationErrorResponse(`選択した作業員が見つかりません: ${notFoundKeys.join(', ')}`);
                }
                workers = snapshots;
            }
            data = { header: header ?? currentData.header, workers };
        } else if (input.type === 'vehicle_todoke') {
            const currentData = existing.data as unknown as VehicleTodokeData;
            let vehicles = currentData.vehicles;
            if (input.vehicles) {
                const { snapshots, notFoundKeys } = await mergeTodokeVehicleSnapshots(currentData.vehicles, input.vehicles);
                if (notFoundKeys.length > 0) {
                    return validationErrorResponse(`選択した車両が見つかりません: ${notFoundKeys.join(', ')}`);
                }
                vehicles = snapshots;
            }
            data = {
                header: header ?? currentData.header,
                periodFrom: input.periodFrom !== undefined ? input.periodFrom : currentData.periodFrom,
                periodTo: input.periodTo !== undefined ? input.periodTo : currentData.periodTo,
                vehicles,
            };
        } else {
            const currentData = existing.data as unknown as KikaiTodokeData;
            let machines = currentData.machines;
            if (input.machines) {
                const { snapshots, notFoundKeys } = await mergeMachineSnapshots(currentData.machines, input.machines);
                if (notFoundKeys.length > 0) {
                    return validationErrorResponse(`選択した機械が見つかりません: ${notFoundKeys.join(', ')}`);
                }
                machines = snapshots;
            }
            data = {
                header: header ?? currentData.header,
                periodFrom: input.periodFrom !== undefined ? input.periodFrom : currentData.periodFrom,
                periodTo: input.periodTo !== undefined ? input.periodTo : currentData.periodTo,
                machines,
            };
        }

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
