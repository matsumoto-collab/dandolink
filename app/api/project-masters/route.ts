import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, parseJsonField, stringifyJsonField, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';

// 配置レコードをフォーマット
function formatAssignment(a: { date: Date; workers: string | null; vehicles: string | null; confirmedWorkerIds: string | null; confirmedVehicleIds: string | null; createdAt: Date; updatedAt: Date; [key: string]: unknown }) {
    return {
        ...a,
        date: a.date.toISOString(),
        workers: parseJsonField<string[]>(a.workers, []),
        vehicles: parseJsonField<string[]>(a.vehicles, []),
        confirmedWorkerIds: parseJsonField<string[]>(a.confirmedWorkerIds, []),
        confirmedVehicleIds: parseJsonField<string[]>(a.confirmedVehicleIds, []),
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
    };
}

// 案件マスターをフォーマット
function formatProjectMaster(pm: { createdBy: string | null; createdAt: Date; updatedAt: Date; assemblyDate?: Date | null; demolitionDate?: Date | null; assignments?: unknown[]; [key: string]: unknown }) {
    return {
        ...pm,
        createdBy: parseJsonField<string[] | null>(pm.createdBy, null),
        createdAt: pm.createdAt.toISOString(),
        updatedAt: pm.updatedAt.toISOString(),
        assemblyDate: pm.assemblyDate?.toISOString() || null,
        demolitionDate: pm.demolitionDate?.toISOString() || null,
        assignments: pm.assignments?.map((a: unknown) => formatAssignment(a as Parameters<typeof formatAssignment>[0])),
    };
}

/**
 * GET /api/project-masters - 案件マスター一覧取得
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const status = searchParams.get('status');
        const search = searchParams.get('search');
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');

        const where: Record<string, unknown> = {};
        if (status) where.status = status;
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
                { location: { contains: search, mode: 'insensitive' } },
            ];
        }

        const include = { assignments: { orderBy: { date: 'desc' as const }, take: 5 } };
        const orderBy = { updatedAt: 'desc' as const };

        if (page && limit) {
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);

            const [projectMasters, total] = await Promise.all([
                prisma.projectMaster.findMany({ where, include, orderBy, skip: (pageNum - 1) * limitNum, take: limitNum }),
                prisma.projectMaster.count({ where }),
            ]);

            return NextResponse.json({
                data: projectMasters.map(formatProjectMaster),
                pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            });
        }

        const projectMasters = await prisma.projectMaster.findMany({ where, include, orderBy });
        return NextResponse.json(projectMasters.map(formatProjectMaster));
    } catch (error) {
        return serverErrorResponse('案件マスター一覧の取得', error);
    }
}

/**
 * POST /api/project-masters - 案件マスター作成
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        if (!canDispatch(session!.user)) {
            return errorResponse('権限がありません', 403);
        }

        const body = await req.json();

        const projectMaster = await prisma.projectMaster.create({
            data: {
                title: body.title,
                customerId: body.customerId || null,
                customerName: body.customerName || null,
                constructionType: body.constructionType || 'other',
                constructionContent: body.constructionContent || null,
                status: body.status || 'active',
                location: body.location || null,
                postalCode: body.postalCode || null,
                prefecture: body.prefecture || null,
                city: body.city || null,
                plusCode: body.plusCode || null,
                area: body.area || null,
                areaRemarks: body.areaRemarks || null,
                assemblyDate: body.assemblyDate ? new Date(body.assemblyDate) : null,
                demolitionDate: body.demolitionDate ? new Date(body.demolitionDate) : null,
                estimatedAssemblyWorkers: body.estimatedAssemblyWorkers || null,
                estimatedDemolitionWorkers: body.estimatedDemolitionWorkers || null,
                contractAmount: body.contractAmount || null,
                scaffoldingSpec: body.scaffoldingSpec || null,
                description: body.description || null,
                remarks: body.remarks || null,
                createdBy: stringifyJsonField(body.createdBy),
            },
        });

        return NextResponse.json(formatProjectMaster(projectMaster));
    } catch (error) {
        return serverErrorResponse('案件マスターの作成', error);
    }
}
