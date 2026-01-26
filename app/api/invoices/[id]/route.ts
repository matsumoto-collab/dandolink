import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireAuth, parseJsonField, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

function formatInvoice(invoice: { items: string | null; [key: string]: unknown }) {
    return { ...invoice, items: parseJsonField<unknown[]>(invoice.items, []) };
}

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const body = await req.json();

        const existingInvoice = await prisma.invoice.findUnique({ where: { id } });
        if (!existingInvoice) return notFoundResponse('請求書');

        const updateData: Prisma.InvoiceUpdateInput = {};
        if (body.projectMasterId !== undefined) updateData.projectMasterId = body.projectMasterId;
        if (body.estimateId !== undefined) updateData.estimateId = body.estimateId || null;
        if (body.invoiceNumber !== undefined) updateData.invoiceNumber = body.invoiceNumber;
        if (body.title !== undefined) updateData.title = body.title;
        if (body.items !== undefined) updateData.items = JSON.stringify(body.items);
        if (body.subtotal !== undefined) updateData.subtotal = body.subtotal;
        if (body.tax !== undefined) updateData.tax = body.tax;
        if (body.total !== undefined) updateData.total = body.total;
        if (body.dueDate !== undefined) updateData.dueDate = new Date(body.dueDate);
        if (body.status !== undefined) updateData.status = body.status;
        if (body.paidDate !== undefined) updateData.paidDate = body.paidDate ? new Date(body.paidDate) : null;
        if (body.notes !== undefined) updateData.notes = body.notes || null;

        const updatedInvoice = await prisma.invoice.update({ where: { id }, data: updateData });
        return NextResponse.json(formatInvoice(updatedInvoice));
    } catch (error) {
        return serverErrorResponse('請求書の更新', error);
    }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const existingInvoice = await prisma.invoice.findUnique({ where: { id } });
        if (!existingInvoice) return notFoundResponse('請求書');

        await prisma.invoice.delete({ where: { id } });
        return NextResponse.json({ message: '請求書を削除しました' });
    } catch (error) {
        return serverErrorResponse('請求書の削除', error);
    }
}
