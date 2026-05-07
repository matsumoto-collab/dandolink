import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updatePayeeSchema, validateRequest } from '@/lib/validations';
import {
    requireAdmin,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
    deleteSuccessResponse,
} from '@/lib/api/utils';

/**
 * Get a single payee
 * GET /api/payees/[id]
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const { id } = params;
        const payee = await prisma.payee.findUnique({ where: { id } });
        if (!payee) {
            return notFoundResponse('振込先');
        }
        return NextResponse.json(payee, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('振込先の取得', error);
    }
}

/**
 * Update a payee
 * PATCH /api/payees/[id]
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const { id } = params;
        const body = await req.json();

        const validation = validateRequest(updatePayeeSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const existing = await prisma.payee.findUnique({ where: { id } });
        if (!existing) {
            return notFoundResponse('振込先');
        }

        const data = validation.data;
        const updateData: Record<string, unknown> = {};

        if (data.name !== undefined) updateData.name = data.name;
        if (data.nameKana !== undefined) updateData.nameKana = data.nameKana || null;
        if (data.alias !== undefined) updateData.alias = data.alias || null;
        if (data.feeBearer !== undefined) updateData.feeBearer = data.feeBearer;
        if (data.bankName !== undefined) updateData.bankName = data.bankName || null;
        if (data.branchName !== undefined) updateData.branchName = data.branchName || null;
        if (data.accountType !== undefined) updateData.accountType = data.accountType || null;
        if (data.accountNumber !== undefined) updateData.accountNumber = data.accountNumber || null;
        if (data.accountHolder !== undefined) updateData.accountHolder = data.accountHolder || null;
        if (data.notes !== undefined) updateData.notes = data.notes || null;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;
        updateData.updatedBy = session!.user.id;

        const updated = await prisma.payee.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('振込先の更新', error);
    }
}

/**
 * Delete a payee
 * DELETE /api/payees/[id]
 * 関連する支払予定がある場合は削除を拒否（onDelete:SetNullになっているが、安全側に倒す）
 */
export async function DELETE(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const { id } = params;

        const existing = await prisma.payee.findUnique({ where: { id } });
        if (!existing) {
            return notFoundResponse('振込先');
        }

        // 参照チェック: この振込先を使っている支払予定があれば、論理削除（isActive=false）を案内
        const referencingCount = await prisma.paymentSchedule.count({ where: { payeeId: id } });
        if (referencingCount > 0) {
            return validationErrorResponse(
                `この振込先は${referencingCount}件の支払予定で使用されています。完全削除はできないため、「利用しない」設定（無効化）をご利用ください`
            );
        }

        await prisma.payee.delete({ where: { id } });

        return deleteSuccessResponse('振込先');
    } catch (error) {
        return serverErrorResponse('振込先の削除', error);
    }
}
