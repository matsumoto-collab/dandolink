import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireManagerOrAbove, notFoundResponse, serverErrorResponse, validationErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import { formatInvoice } from '@/lib/formatters';
import { updateInvoiceSchema, validateRequest } from '@/lib/validations';

interface RouteContext { params: Promise<{ id: string }>; }

/** 請求書に紐付く案件マスタ情報を取得 */
async function getInvoiceProjectMasters(invoiceId: string) {
    const links = await prisma.invoiceProjectMaster.findMany({
        where: { invoiceId },
        orderBy: { sortOrder: 'asc' },
        select: { projectMasterId: true },
    });
    if (links.length === 0) return [];
    const pmIds = links.map(l => l.projectMasterId);
    const pms = await prisma.projectMaster.findMany({
        where: { id: { in: pmIds } },
        select: { id: true, title: true },
    });
    return pmIds.map(id => pms.find(p => p.id === id)).filter(Boolean) as Array<{ id: string; title: string }>;
}

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await context.params;
        const body = await req.json();

        // projectMasterIds は Zod スキーマ外なので先に取り出す
        const { projectMasterIds, customerId, ...rest } = body;

        const validation = validateRequest(updateInvoiceSchema, rest);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);

        const existingInvoice = await prisma.invoice.findUnique({ where: { id } });
        if (!existingInvoice) return notFoundResponse('請求書');

        const data = validation.data;
        const updateData: Prisma.InvoiceUpdateInput = { updatedBy: session!.user.id };
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
        if (customerId !== undefined) updateData.customerId = customerId || null;

        // 複数案件の更新
        if (Array.isArray(projectMasterIds)) {
            // 代表案件も更新
            updateData.projectMasterId = projectMasterIds[0] || null;

            // 中間テーブルを差し替え
            await prisma.invoiceProjectMaster.deleteMany({ where: { invoiceId: id } });
            if (projectMasterIds.length > 0) {
                await prisma.invoiceProjectMaster.createMany({
                    data: projectMasterIds.map((pmId: string, i: number) => ({
                        invoiceId: id,
                        projectMasterId: pmId,
                        sortOrder: i,
                    })),
                });
            }
        }

        const updatedInvoice = await prisma.invoice.update({ where: { id }, data: updateData });
        const formatted = formatInvoice(updatedInvoice);
        const projectMasters = await getInvoiceProjectMasters(id);
        return NextResponse.json({
            ...formatted,
            projectMasters,
            projectMasterIds: projectMasters.map(p => p.id),
        });
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

        // 中間テーブルも削除
        await prisma.invoiceProjectMaster.deleteMany({ where: { invoiceId: id } });
        await prisma.invoice.delete({ where: { id } });
        return deleteSuccessResponse('請求書');
    } catch (error) {
        return serverErrorResponse('請求書の削除', error);
    }
}
