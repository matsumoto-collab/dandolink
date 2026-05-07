import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updatePaymentScheduleSchema, validateRequest } from '@/lib/validations';
import {
    requireAdmin,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
    deleteSuccessResponse,
} from '@/lib/api/utils';

/**
 * Get a single payment schedule
 * GET /api/payment-schedules/[id]
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const item = await prisma.paymentSchedule.findUnique({
            where: { id: params.id },
            include: { payee: true },
        });
        if (!item) return notFoundResponse('支払予定');
        return NextResponse.json(item, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('支払予定の取得', error);
    }
}

/**
 * Update a payment schedule
 * PATCH /api/payment-schedules/[id]
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const body = await req.json();
        const validation = validateRequest(updatePaymentScheduleSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const existing = await prisma.paymentSchedule.findUnique({ where: { id: params.id } });
        if (!existing) return notFoundResponse('支払予定');

        const data = validation.data;
        const updateData: Record<string, unknown> = {};

        if (data.paymentDate !== undefined) updateData.paymentDate = new Date(data.paymentDate);
        if (data.paymentType !== undefined) updateData.paymentType = data.paymentType;
        if (data.payeeId !== undefined) updateData.payeeId = data.payeeId || null;
        if (data.payeeName !== undefined) updateData.payeeName = data.payeeName;
        if (data.amount !== undefined) updateData.amount = data.amount;
        if (data.feeFlag !== undefined) updateData.feeFlag = data.feeFlag;
        if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
        if (data.bankName !== undefined) updateData.bankName = data.bankName || null;
        if (data.branchName !== undefined) updateData.branchName = data.branchName || null;
        if (data.accountType !== undefined) updateData.accountType = data.accountType || null;
        if (data.accountNumber !== undefined) updateData.accountNumber = data.accountNumber || null;
        if (data.accountHolder !== undefined) updateData.accountHolder = data.accountHolder || null;
        if (data.notes !== undefined) updateData.notes = data.notes || null;
        if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

        // 支払済切り替え時に paidAt/paidBy を自動セット
        if (data.isPaid !== undefined) {
            updateData.isPaid = data.isPaid;
            if (data.isPaid && !existing.isPaid) {
                updateData.paidAt = new Date();
                updateData.paidBy = session!.user.id;
            } else if (!data.isPaid && existing.isPaid) {
                updateData.paidAt = null;
                updateData.paidBy = null;
            }
        }

        updateData.updatedBy = session!.user.id;

        const updated = await prisma.paymentSchedule.update({
            where: { id: params.id },
            data: updateData,
            include: { payee: true },
        });

        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('支払予定の更新', error);
    }
}

/**
 * Delete a payment schedule
 * DELETE /api/payment-schedules/[id]
 */
export async function DELETE(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const existing = await prisma.paymentSchedule.findUnique({ where: { id: params.id } });
        if (!existing) return notFoundResponse('支払予定');

        await prisma.paymentSchedule.delete({ where: { id: params.id } });
        return deleteSuccessResponse('支払予定');
    } catch (error) {
        return serverErrorResponse('支払予定の削除', error);
    }
}
