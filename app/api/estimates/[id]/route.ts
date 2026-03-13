import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireManagerOrAbove, notFoundResponse, serverErrorResponse, validationErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import { formatEstimate } from '@/lib/formatters';
import { updateEstimateSchema, validateRequest } from '@/lib/validations';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const body = await req.json();

        const validation = validateRequest(updateEstimateSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);

        const existingEstimate = await prisma.estimate.findUnique({ where: { id } });
        if (!existingEstimate) return notFoundResponse('見積');

        const data = validation.data;
        const updateData: Prisma.EstimateUpdateInput = {};
        if (data.projectMasterId !== undefined) updateData.projectMasterId = data.projectMasterId || null;
        if (data.customerId !== undefined) updateData.customerId = data.customerId || null;
        if (data.estimateNumber !== undefined) updateData.estimateNumber = data.estimateNumber;
        if (data.title !== undefined) updateData.title = data.title;
        if (data.items !== undefined) updateData.items = JSON.stringify(data.items);
        if (data.subtotal !== undefined) updateData.subtotal = data.subtotal;
        if (data.tax !== undefined) updateData.tax = data.tax;
        if (data.total !== undefined) updateData.total = data.total;
        if (data.validUntil !== undefined) updateData.validUntil = new Date(data.validUntil);
        if (data.status !== undefined) updateData.status = data.status;
        if (data.notes !== undefined) updateData.notes = data.notes || null;

        const updatedEstimate = await prisma.estimate.update({ where: { id }, data: updateData });
        return NextResponse.json(formatEstimate(updatedEstimate));
    } catch (error) {
        return serverErrorResponse('見積の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const existingEstimate = await prisma.estimate.findUnique({ where: { id } });
        if (!existingEstimate) return notFoundResponse('見積');

        await prisma.estimate.delete({ where: { id } });
        return deleteSuccessResponse('見積');
    } catch (error) {
        return serverErrorResponse('見積の削除', error);
    }
}
