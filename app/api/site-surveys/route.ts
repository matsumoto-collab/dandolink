// 現場調査（図面）API: 一覧取得 / 新規作成
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    validationErrorResponse,
    serverErrorResponse,
} from '@/lib/api/utils';
import { logger } from '@/lib/logger';

// Prisma の SiteSurvey レコードをフロント向けの形に整形
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

// マイグレーション未実施でも UI が壊れないようにフォールバック
function isMissingTableError(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2021' || error.code === 'P2022')
    );
}

export async function GET(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const projectMasterId = searchParams.get('projectMasterId');

        const where: Prisma.SiteSurveyWhereInput = {};
        if (projectMasterId) where.projectMasterId = projectMasterId;

        try {
            const records = await prisma.siteSurvey.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
            });
            return NextResponse.json(records.map(formatSiteSurvey), {
                headers: { 'Cache-Control': 'no-store' },
            });
        } catch (dbError) {
            if (isMissingTableError(dbError)) {
                logger.warn('[site-surveys] テーブル未作成のため空配列を返却', { error: dbError });
                return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
            }
            throw dbError;
        }
    } catch (error) {
        return serverErrorResponse('現場調査一覧の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();
        if (!body || typeof body !== 'object') {
            return validationErrorResponse('リクエストボディが不正です');
        }
        if (!body.title || typeof body.title !== 'string') {
            return validationErrorResponse('タイトルは必須です');
        }
        if (!body.drawingData || typeof body.drawingData !== 'object') {
            return validationErrorResponse('drawingData は必須です');
        }

        const data: Prisma.SiteSurveyCreateInput = {
            title: body.title,
            customerName: body.customerName ?? null,
            workType: body.workType ?? null,
            managerIds: Array.isArray(body.managerIds) ? body.managerIds : [],
            scheduledDate: body.scheduledDate ? new Date(body.scheduledDate) : null,
            notes: body.notes ?? null,
            handoffNotes: body.handoffNotes ?? null,
            arrivalTime: body.arrivalTime ?? null,
            vehicleSpec: body.vehicleSpec ?? null,
            drawingData: body.drawingData,
            scaffoldSpec: body.scaffoldSpec ?? Prisma.DbNull,
            surroundings: body.surroundings ?? Prisma.DbNull,
            perimeter: typeof body.perimeter === 'number' ? body.perimeter : null,
            floorArea: typeof body.floorArea === 'number' ? body.floorArea : null,
            scaffoldArea: typeof body.scaffoldArea === 'number' ? body.scaffoldArea : null,
            createdBy: session!.user.id,
            updatedBy: session!.user.id,
            ...(body.projectMasterId
                ? { projectMaster: { connect: { id: body.projectMasterId } } }
                : {}),
        };

        try {
            const created = await prisma.siteSurvey.create({ data });
            return NextResponse.json(formatSiteSurvey(created));
        } catch (dbError) {
            if (isMissingTableError(dbError)) {
                return NextResponse.json(
                    {
                        error:
                            'SiteSurvey テーブルがまだ作成されていません。`prisma migrate` の実行が必要です。',
                    },
                    { status: 503 },
                );
            }
            throw dbError;
        }
    } catch (error) {
        return serverErrorResponse('現場調査の作成', error);
    }
}
