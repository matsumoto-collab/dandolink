import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, validationErrorResponse, serverErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';
import { canDispatch } from '@/utils/permissions';
import { createProjectMasterSchema, validateRequest } from '@/lib/validations';
import { formatProjectMaster } from '@/lib/formatters';

/**
 * GET /api/project-masters - 案件マスター一覧取得
 */
export async function GET(req: NextRequest) {
    const rateLimitError = applyRateLimit(req, RATE_LIMITS.api);
    if (rateLimitError) return rateLimitError;

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

        const include = { _count: { select: { assignments: true } } };
        const orderBy = { updatedAt: 'desc' as const };

        if (page && limit) {
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
                return validationErrorResponse('無効なページネーションパラメータです');
            }

            const [projectMasters, total] = await Promise.all([
                prisma.projectMaster.findMany({ where, include, orderBy, skip: (pageNum - 1) * limitNum, take: limitNum }),
                prisma.projectMaster.count({ where }),
            ]);

            return NextResponse.json({
                data: projectMasters.map(formatProjectMaster),
                pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        const projectMasters = await prisma.projectMaster.findMany({ where, include, orderBy });
        return NextResponse.json(projectMasters.map(formatProjectMaster), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('案件マスター一覧の取得', error);
    }
}

/**
 * POST /api/project-masters - 案件マスター作成
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
        const validation = validateRequest(createProjectMasterSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error, validation.details);

        const { title, customerId, customerName, customerShortName, constructionType, constructionContent, status, location, postalCode, prefecture, city, plusCode, latitude, longitude, area, areaRemarks, assemblyDate, demolitionDate, estimatedAssemblyWorkers, estimatedDemolitionWorkers, contractAmount, scaffoldingSpec, description, remarks, createdBy } = validation.data;

        // customerShortNameが未指定の場合、Customerテーブルから自動取得
        let resolvedCustomerShortName = customerShortName || null;
        let resolvedCustomerId = customerId || null;
        if (!resolvedCustomerShortName && customerName) {
            const customer = await prisma.customer.findFirst({
                where: { name: customerName },
                select: { id: true, shortName: true },
            });
            if (customer) {
                resolvedCustomerShortName = customer.shortName || null;
                if (!resolvedCustomerId) {
                    resolvedCustomerId = customer.id;
                }
            }
        }

        const projectMaster = await prisma.projectMaster.create({
            data: {
                title, customerId: resolvedCustomerId, customerName: customerName || null, customerShortName: resolvedCustomerShortName,
                constructionType: constructionType || 'other', constructionContent: constructionContent || null,
                status: status || 'active', location: location || null, postalCode: postalCode || null,
                prefecture: prefecture || null, city: city || null, plusCode: plusCode || null,
                latitude: latitude ?? null, longitude: longitude ?? null,
                area: area || null, areaRemarks: areaRemarks || null,
                assemblyDate: assemblyDate ? new Date(assemblyDate) : null,
                demolitionDate: demolitionDate ? new Date(demolitionDate) : null,
                estimatedAssemblyWorkers: estimatedAssemblyWorkers || null,
                estimatedDemolitionWorkers: estimatedDemolitionWorkers || null,
                contractAmount: contractAmount || null, scaffoldingSpec: scaffoldingSpec || undefined,
                description: description || null, remarks: remarks || null,
                createdBy: stringifyJsonField(createdBy),
            },
        });

        return NextResponse.json(formatProjectMaster(projectMaster));
    } catch (error) {
        return serverErrorResponse('案件マスターの作成', error);
    }
}
