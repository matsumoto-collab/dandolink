import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireManagerOrAbove, notFoundResponse, serverErrorResponse, validationErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import { formatInvoice } from '@/lib/formatters';
import { updateInvoiceSchema, validateRequest } from '@/lib/validations';

interface RouteContext { params: Promise<{ id: string }>; }

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const body = await req.json();

        const validation = validateRequest(updateInvoiceSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);

        const existingInvoice = await prisma.invoice.findUnique({ where: { id } });
        if (!existingInvoice) return notFoundResponse('請求書');

        const data = validation.data;
        const updateData: Prisma.InvoiceUpdateInput = {};
        if (data.projectMasterId !== undefined) updateData.projectMasterId = data.projectMasterId;
        if (data.estimateId !== undefined) updateData.estimateId = data.estimateId || null;
        if (data.invoiceNumber !== undefined) updateData.invoiceNumber = data.invoiceNumber;
        if (data.title !== undefined) updateData.title = data.title;
        if (data.items !== undefined) updateData.items = JSON.stringify(data.items);
        if (data.subtotal !== undefined) updateData.subtotal = data.subtotal;
        if (data.tax !== undefined) updateData.tax = data.tax;
        if (data.total !== undefined) updateData.total = data.total;
        if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate);
        if (data.status !== undefined) updateData.status = data.status;
        if (data.paidDate !== undefined) updateData.paidDate = data.paidDate ? new Date(data.paidDate) : null;
        if (data.notes !== undefined) updateData.notes = data.notes || null;

        const updatedInvoice = await prisma.invoice.update({ where: { id }, data: updateData });
        return NextResponse.json(formatInvoice(updatedInvoice));
    } catch (error) {
        return serverErrorResponse('請求書の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const existingInvoice = await prisma.invoice.findUnique({ where: { id } });
        if (!existingInvoice) return notFoundResponse('請求書');

        await prisma.invoice.delete({ where: { id } });
        return deleteSuccessResponse('請求書');
    } catch (error) {
        return serverErrorResponse('請求書の削除', error);
    }
}
