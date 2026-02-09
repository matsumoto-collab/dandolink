import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireAuth, notFoundResponse, serverErrorResponse, validationErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import { formatEstimate } from '@/lib/formatters';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const body = await req.json();

        const existingEstimate = await prisma.estimate.findUnique({ where: { id } });
        if (!existingEstimate) return notFoundResponse('見積');

        const updateData: Prisma.EstimateUpdateInput = {};
        if (body.projectMasterId !== undefined) updateData.projectMasterId = body.projectMasterId || null;
        if (body.estimateNumber !== undefined) updateData.estimateNumber = body.estimateNumber;
        if (body.title !== undefined) updateData.title = body.title;
        if (body.items !== undefined) updateData.items = JSON.stringify(body.items);
        if (body.subtotal !== undefined) updateData.subtotal = body.subtotal;
        if (body.tax !== undefined) updateData.tax = body.tax;
        if (body.total !== undefined) updateData.total = body.total;
        if (body.validUntil !== undefined) updateData.validUntil = new Date(body.validUntil);
        if (body.status !== undefined) {
            const VALID_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];
            if (!VALID_STATUSES.includes(body.status)) return validationErrorResponse(`statusは${VALID_STATUSES.join(', ')}のいずれかを指定してください`);
            updateData.status = body.status;
        }
        if (body.notes !== undefined) updateData.notes = body.notes || null;

        const updatedEstimate = await prisma.estimate.update({ where: { id }, data: updateData });
        return NextResponse.json(formatEstimate(updatedEstimate));
    } catch (error) {
        return serverErrorResponse('見積の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
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
