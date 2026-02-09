import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { canDispatch, isManagerOrAbove } from '@/utils/permissions';
import { formatProjectMaster } from '@/lib/formatters';

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const projectMaster = await prisma.projectMaster.findUnique({ where: { id }, include: { assignments: { orderBy: { date: 'desc' } } } });

        if (!projectMaster) return notFoundResponse('案件マスター');
        return NextResponse.json(formatProjectMaster(projectMaster));
    } catch (error) {
        return serverErrorResponse('案件マスターの取得', error);
    }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await req.json();

        const VALID_STATUSES = ['active', 'completed', 'cancelled'];

        const updateData: Record<string, unknown> = {};
        if (body.title !== undefined) updateData.title = body.title;
        if (body.customerId !== undefined) updateData.customerId = body.customerId;
        if (body.customerName !== undefined) updateData.customerName = body.customerName;
        if (body.constructionType !== undefined) updateData.constructionType = body.constructionType;
        if (body.constructionContent !== undefined) updateData.constructionContent = body.constructionContent;
        if (body.status !== undefined) {
            if (!VALID_STATUSES.includes(body.status)) return validationErrorResponse(`statusは${VALID_STATUSES.join(', ')}のいずれかを指定してください`);
            updateData.status = body.status;
        }
        if (body.location !== undefined) updateData.location = body.location;
        if (body.postalCode !== undefined) updateData.postalCode = body.postalCode;
        if (body.prefecture !== undefined) updateData.prefecture = body.prefecture;
        if (body.city !== undefined) updateData.city = body.city;
        if (body.plusCode !== undefined) updateData.plusCode = body.plusCode;
        if (body.area !== undefined) updateData.area = body.area;
        if (body.areaRemarks !== undefined) updateData.areaRemarks = body.areaRemarks;
        if (body.assemblyDate !== undefined) updateData.assemblyDate = body.assemblyDate ? new Date(body.assemblyDate) : null;
        if (body.demolitionDate !== undefined) updateData.demolitionDate = body.demolitionDate ? new Date(body.demolitionDate) : null;
        if (body.estimatedAssemblyWorkers !== undefined) updateData.estimatedAssemblyWorkers = body.estimatedAssemblyWorkers;
        if (body.estimatedDemolitionWorkers !== undefined) updateData.estimatedDemolitionWorkers = body.estimatedDemolitionWorkers;
        if (body.contractAmount !== undefined) {
            if (typeof body.contractAmount === 'number' && body.contractAmount < 0) return validationErrorResponse('契約金額は0以上で指定してください');
            updateData.contractAmount = body.contractAmount;
        }
        if (body.scaffoldingSpec !== undefined) updateData.scaffoldingSpec = body.scaffoldingSpec;
        if (body.description !== undefined) updateData.description = body.description;
        if (body.remarks !== undefined) updateData.remarks = body.remarks;
        if (body.createdBy !== undefined) updateData.createdBy = stringifyJsonField(body.createdBy);

        const projectMaster = await prisma.projectMaster.update({ where: { id }, data: updateData });
        return NextResponse.json(formatProjectMaster(projectMaster));
    } catch (error) {
        return serverErrorResponse('案件マスターの更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        await prisma.projectMaster.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('案件マスターの削除', error);
    }
}
