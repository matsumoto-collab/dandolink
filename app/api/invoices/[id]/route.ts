import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

/**
 * Update an invoice
 * PATCH /api/invoices/[id]
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = params;
        const body = await req.json();

        // Check if invoice exists
        const existingInvoice = await prisma.invoice.findUnique({
            where: { id },
        });

        if (!existingInvoice) {
            return NextResponse.json(
                { error: '請求書が見つかりません' },
                { status: 404 }
            );
        }

        // Prepare update data
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

        // Update invoice
        const updatedInvoice = await prisma.invoice.update({
            where: { id },
            data: updateData,
        });

        // Parse JSON fields for response
        const response = {
            ...updatedInvoice,
            items: updatedInvoice.items ? JSON.parse(updatedInvoice.items) : [],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Update invoice error:', error);
        return NextResponse.json(
            { error: '請求書の更新に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Delete an invoice
 * DELETE /api/invoices/[id]
 */
export async function DELETE(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = params;

        // Check if invoice exists
        const existingInvoice = await prisma.invoice.findUnique({
            where: { id },
        });

        if (!existingInvoice) {
            return NextResponse.json(
                { error: '請求書が見つかりません' },
                { status: 404 }
            );
        }

        // Delete invoice
        await prisma.invoice.delete({
            where: { id },
        });

        return NextResponse.json({ message: '請求書を削除しました' });
    } catch (error) {
        console.error('Delete invoice error:', error);
        return NextResponse.json(
            { error: '請求書の削除に失敗しました' },
            { status: 500 }
        );
    }
}
