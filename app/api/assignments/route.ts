import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, serverErrorResponse, validationErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { createAssignmentSchema, validateRequest } from '@/lib/validations';
import { formatAssignment } from '@/lib/formatters';

/**
 * GET /api/assignments - 配置一覧取得
 */
export async function GET(req: NextRequest) {
    const rateLimitError = applyRateLimit(req, RATE_LIMITS.api);
    if (rateLimitError) return rateLimitError;

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
    const rateLimitError = applyRateLimit(req, RATE_LIMITS.api);
    if (rateLimitError) return rateLimitError;

    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (!canDispatch(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const body = await req.json();
        const validation = validateRequest(createAssignmentSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error, validation.details);

        const { projectMasterId, assignedEmployeeId, date, memberCount, workers, vehicles, meetingTime, sortOrder, remarks, isDispatchConfirmed, confirmedWorkerIds, confirmedVehicleIds } = validation.data;

        const existing = await prisma.projectAssignment.findUnique({
            where: { projectMasterId_assignedEmployeeId_date: { projectMasterId, assignedEmployeeId, date: new Date(date) } },
        });
        if (existing) return errorResponse('同一案件・同一職長・同一日付の配置は既に存在します', 400);

        const assignment = await prisma.projectAssignment.create({
            data: {
                projectMasterId, assignedEmployeeId, date: new Date(date),
                memberCount: memberCount || 0, workers: stringifyJsonField(workers), vehicles: stringifyJsonField(vehicles),
                meetingTime: meetingTime || null, sortOrder: sortOrder || 0, remarks: remarks || null,
                isDispatchConfirmed: isDispatchConfirmed || false,
                confirmedWorkerIds: stringifyJsonField(confirmedWorkerIds), confirmedVehicleIds: stringifyJsonField(confirmedVehicleIds),
            },
            include: { projectMaster: true },
        });

        return NextResponse.json(formatAssignment(assignment));
    } catch (error) {
        return serverErrorResponse('配置の作成', error);
    }
}
