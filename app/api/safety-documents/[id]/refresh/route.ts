import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    notFoundResponse,
} from '@/lib/api/utils';
import {
    refreshMachineSnapshots,
    refreshMeiboWorkerSnapshots,
    refreshTodokeVehicleSnapshots,
} from '@/lib/api/safetySnapshot';
import type { KikaiTodokeData, SafetyDocumentData, SagyoinMeiboData, VehicleTodokeData } from '@/lib/safetyDocuments';

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

        // 種別ごとに最新化。書類固有入力（運転者・取扱者）は維持される
        let data: SafetyDocumentData;
        let notFoundKeys: string[];
        if (existing.type === 'vehicle_todoke') {
            const currentData = existing.data as unknown as VehicleTodokeData;
            const result = await refreshTodokeVehicleSnapshots(currentData.vehicles);
            notFoundKeys = result.notFoundKeys;
            data = { ...currentData, vehicles: result.snapshots };
        } else if (existing.type === 'kikai_todoke' || existing.type === 'crane_todoke') {
            const currentData = existing.data as unknown as KikaiTodokeData;
            const result = await refreshMachineSnapshots(currentData.machines);
            notFoundKeys = result.notFoundKeys;
            data = { ...currentData, machines: result.snapshots };
        } else {
            const currentData = existing.data as unknown as SagyoinMeiboData;
            const result = await refreshMeiboWorkerSnapshots(currentData.workers);
            notFoundKeys = result.notFoundKeys;
            data = { header: currentData.header, workers: result.snapshots };
        }

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
