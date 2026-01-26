import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    parseJsonField,
    stringifyJsonField,
    errorResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';

// 配置レコードをフォーマット
function formatAssignment(a: {
    date: Date;
    workers: string | null;
    vehicles: string | null;
    confirmedWorkerIds: string | null;
    confirmedVehicleIds: string | null;
    createdAt: Date;
    updatedAt: Date;
    projectMaster?: {
        createdBy: string | null;
        createdAt: Date;
        updatedAt: Date;
    } | null;
    [key: string]: unknown;
}) {
    return {
        ...a,
        date: a.date.toISOString(),
        workers: parseJsonField<string[]>(a.workers, []),
        vehicles: parseJsonField<string[]>(a.vehicles, []),
        confirmedWorkerIds: parseJsonField<string[]>(a.confirmedWorkerIds, []),
        confirmedVehicleIds: parseJsonField<string[]>(a.confirmedVehicleIds, []),
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        projectMaster: a.projectMaster ? {
            ...a.projectMaster,
            createdBy: parseJsonField<string[] | null>(a.projectMaster.createdBy, null),
            createdAt: a.projectMaster.createdAt.toISOString(),
            updatedAt: a.projectMaster.updatedAt.toISOString(),
        } : null,
    };
}

/**
 * GET /api/assignments - 配置一覧取得
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const assignedEmployeeId = searchParams.get('assignedEmployeeId');
        const projectMasterId = searchParams.get('projectMasterId');

        const where: Record<string, unknown> = {};

        if (startDate || endDate) {
            where.date = {};
            if (startDate) (where.date as Record<string, Date>).gte = new Date(startDate);
            if (endDate) (where.date as Record<string, Date>).lte = new Date(endDate);
        }
        if (assignedEmployeeId) where.assignedEmployeeId = assignedEmployeeId;
        if (projectMasterId) where.projectMasterId = projectMasterId;

        const assignments = await prisma.projectAssignment.findMany({
            where,
            include: { projectMaster: true },
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
        });

        return NextResponse.json(assignments.map(formatAssignment));
    } catch (error) {
        return serverErrorResponse('配置一覧の取得', error);
    }
}

/**
 * POST /api/assignments - 配置作成
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (!canDispatch(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const body = await req.json();

        if (!body.projectMasterId || !body.assignedEmployeeId || !body.date) {
            return validationErrorResponse('projectMasterId, assignedEmployeeId, date は必須です');
        }

        // 重複チェック
        const existing = await prisma.projectAssignment.findUnique({
            where: {
                projectMasterId_assignedEmployeeId_date: {
                    projectMasterId: body.projectMasterId,
                    assignedEmployeeId: body.assignedEmployeeId,
                    date: new Date(body.date),
                },
            },
        });

        if (existing) {
            return errorResponse('同一案件・同一職長・同一日付の配置は既に存在します', 400);
        }

        const assignment = await prisma.projectAssignment.create({
            data: {
                projectMasterId: body.projectMasterId,
                assignedEmployeeId: body.assignedEmployeeId,
                date: new Date(body.date),
                memberCount: body.memberCount || 0,
                workers: stringifyJsonField(body.workers),
                vehicles: stringifyJsonField(body.vehicles),
                meetingTime: body.meetingTime || null,
                sortOrder: body.sortOrder || 0,
                remarks: body.remarks || null,
                isDispatchConfirmed: body.isDispatchConfirmed || false,
                confirmedWorkerIds: stringifyJsonField(body.confirmedWorkerIds),
                confirmedVehicleIds: stringifyJsonField(body.confirmedVehicleIds),
            },
            include: { projectMaster: true },
        });

        return NextResponse.json(formatAssignment(assignment));
    } catch (error) {
        return serverErrorResponse('配置の作成', error);
    }
}
