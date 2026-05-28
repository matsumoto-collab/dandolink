import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updateBillingDraftSchema, validateRequest } from '@/lib/validations';
import {
    requireManagerOrAbove,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
    deleteSuccessResponse,
    errorResponse,
} from '@/lib/api/utils';

const billingDraftInclude = {
    projectMaster: { select: { id: true, title: true, name: true } },
    customer: { select: { id: true, name: true } },
    createdBy: { select: { id: true, displayName: true, username: true } },
    invoice: { select: { id: true, invoiceNumber: true, status: true } },
} as const;

/**
 * Get a single billing draft
 * GET /api/billing-drafts/[id]
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const item = await prisma.billingDraft.findUnique({
            where: { id: params.id },
            include: billingDraftInclude,
        });
        if (!item) return notFoundResponse('請求予定');
        return NextResponse.json(item, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求予定の取得', error);
    }
}

/**
 * Update a billing draft (pending only)
 * PATCH /api/billing-drafts/[id]
 *
 * confirmed / cancelled / 論理削除済の編集は不可（API ガード + DB トリガで二重防御）。
 * 編集可能フィールド: title / amount / taxRate / note のみ。
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();
        const validation = validateRequest(updateBillingDraftSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const existing = await prisma.billingDraft.findUnique({ where: { id: params.id } });
        if (!existing) return notFoundResponse('請求予定');

        if (existing.deletedAt) {
            return errorResponse('削除済みの請求予定は編集できません', 400);
        }
        if (existing.status !== 'pending') {
            return errorResponse('保留中の請求予定のみ編集できます', 400);
        }

        const data = validation.data;
        const updateData: Record<string, unknown> = {};

        if (data.title !== undefined) updateData.title = data.title.trim();
        if (data.amount !== undefined) updateData.amount = data.amount;
        if (data.taxRate !== undefined) updateData.taxRate = data.taxRate;
        if (data.note !== undefined) updateData.note = data.note?.trim() || null;

        const updated = await prisma.billingDraft.update({
            where: { id: params.id },
            data: updateData,
            include: billingDraftInclude,
        });

        return NextResponse.json(updated, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求予定の更新', error);
    }
}

/**
 * Logically delete a billing draft (sets deletedAt)
 * DELETE /api/billing-drafts/[id]
 *
 * 論理削除のみ（物理削除は将来別 API で対応）。
 * confirmed の請求予定は削除不可（請求書化済のため）。
 */
export async function DELETE(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const existing = await prisma.billingDraft.findUnique({ where: { id: params.id } });
        if (!existing) return notFoundResponse('請求予定');

        if (existing.deletedAt) {
            return errorResponse('既に削除済みです', 400);
        }
        if (existing.status === 'confirmed') {
            return errorResponse('確定済みの請求予定は削除できません', 400);
        }

        await prisma.billingDraft.update({
            where: { id: params.id },
            data: { deletedAt: new Date() },
        });
        return deleteSuccessResponse('請求予定');
    } catch (error) {
        return serverErrorResponse('請求予定の削除', error);
    }
}
