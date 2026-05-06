// 現場調査（図面）API: 個別取得 / 更新 / 削除
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
    deleteSuccessResponse,
} from '@/lib/api/utils';
import { logger } from '@/lib/logger';

interface RouteContext {
    params: Promise<{ id: string }>;
}

function formatSiteSurvey(record: any) {
    return {
        id: record.id,
        projectMasterId: record.projectMasterId,
        title: record.title,
        customerName: record.customerName,
        workType: record.workType,
        managerIds: record.managerIds ?? [],
        scheduledDate: record.scheduledDate?.toISOString?.() ?? null,
        notes: record.notes,
        handoffNotes: record.handoffNotes,
        arrivalTime: record.arrivalTime,
        vehicleSpec: record.vehicleSpec,
        drawingData: record.drawingData,
        scaffoldSpec: record.scaffoldSpec ?? null,
        surroundings: record.surroundings ?? null,
        perimeter: record.perimeter,
        floorArea: record.floorArea,
        scaffoldArea: record.scaffoldArea,
        createdBy: record.createdBy,
        createdAt: record.createdAt?.toISOString?.() ?? record.createdAt,
        updatedAt: record.updatedAt?.toISOString?.() ?? record.updatedAt,
        updatedBy: record.updatedBy,
    };
}

function isMissingTableError(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2021' || error.code === 'P2022')
    );
}

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;
        const { id } = await context.params;

        try {
            const record = await prisma.siteSurvey.findUnique({ where: { id } });
            if (!record) return notFoundResponse('現場調査');
            return NextResponse.json(formatSiteSurvey(record), {
                headers: { 'Cache-Control': 'no-store' },
            });
        } catch (dbError) {
            if (isMissingTableError(dbError)) {
                logger.warn('[site-surveys] テーブル未作成', { error: dbError });
                return notFoundResponse('現場調査');
            }
            throw dbError;
        }
    } catch (error) {
        return serverErrorResponse('現場調査の取得', error);
    }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;
        const { id } = await context.params;
        const body = await req.json();
        if (!body || typeof body !== 'object') {
            return validationErrorResponse('リクエストボディが不正です');
        }

        const updateData: Prisma.SiteSurveyUpdateInput = {
            updatedBy: session!.user.id,
        };
        if (body.title !== undefined) updateData.title = body.title;
        if (body.customerName !== undefined) updateData.customerName = body.customerName ?? null;
        if (body.workType !== undefined) updateData.workType = body.workType ?? null;
        if (body.managerIds !== undefined)
            updateData.managerIds = Array.isArray(body.managerIds) ? body.managerIds : [];
        if (body.scheduledDate !== undefined)
            updateData.scheduledDate = body.scheduledDate ? new Date(body.scheduledDate) : null;
        if (body.notes !== undefined) updateData.notes = body.notes ?? null;
        if (body.handoffNotes !== undefined) updateData.handoffNotes = body.handoffNotes ?? null;
        if (body.arrivalTime !== undefined) updateData.arrivalTime = body.arrivalTime ?? null;
        if (body.vehicleSpec !== undefined) updateData.vehicleSpec = body.vehicleSpec ?? null;
        if (body.drawingData !== undefined) updateData.drawingData = body.drawingData;
        if (body.scaffoldSpec !== undefined)
            updateData.scaffoldSpec = body.scaffoldSpec ?? Prisma.DbNull;
        if (body.surroundings !== undefined)
            updateData.surroundings = body.surroundings ?? Prisma.DbNull;
        if (body.perimeter !== undefined)
            updateData.perimeter = typeof body.perimeter === 'number' ? body.perimeter : null;
        if (body.floorArea !== undefined)
            updateData.floorArea = typeof body.floorArea === 'number' ? body.floorArea : null;
        if (body.scaffoldArea !== undefined)
            updateData.scaffoldArea =
                typeof body.scaffoldArea === 'number' ? body.scaffoldArea : null;
        if (body.projectMasterId !== undefined) {
            updateData.projectMaster = body.projectMasterId
                ? { connect: { id: body.projectMasterId } }
                : { disconnect: true };
        }

        try {
            const existing = await prisma.siteSurvey.findUnique({ where: { id } });
            if (!existing) return notFoundResponse('現場調査');
            const updated = await prisma.siteSurvey.update({ where: { id }, data: updateData });
            return NextResponse.json(formatSiteSurvey(updated));
        } catch (dbError) {
            if (isMissingTableError(dbError)) {
                return NextResponse.json(
                    { error: 'SiteSurvey テーブルがまだ作成されていません。' },
                    { status: 503 },
                );
            }
            throw dbError;
        }
    } catch (error) {
        return serverErrorResponse('現場調査の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;
        const { id } = await context.params;
        try {
            const existing = await prisma.siteSurvey.findUnique({ where: { id } });
            if (!existing) return notFoundResponse('現場調査');
            await prisma.siteSurvey.delete({ where: { id } });
            return deleteSuccessResponse('現場調査');
        } catch (dbError) {
            if (isMissingTableError(dbError)) return notFoundResponse('現場調査');
            throw dbError;
        }
    } catch (error) {
        return serverErrorResponse('現場調査の削除', error);
    }
}
