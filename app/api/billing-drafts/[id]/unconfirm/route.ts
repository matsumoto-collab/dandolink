import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    notFoundResponse,
    serverErrorResponse,
    errorResponse,
} from '@/lib/api/utils';
import { formatBillingDraft } from '@/lib/formatters';

const billingDraftInclude = {
    projectMaster: { select: { id: true, title: true, name: true } },
    customer: { select: { id: true, name: true } },
    createdBy: { select: { id: true, displayName: true, username: true } },
    invoice: { select: { id: true, invoiceNumber: true, status: true } },
} as const;

/**
 * 確定解除：確定済み（confirmed）の請求予定を保留中（pending）に戻す。
 * POST /api/billing-drafts/[id]/unconfirm
 *
 * - status: confirmed → pending、invoiceId → null（発行済み請求書との紐づけを解除）。
 *   戻した後は通常どおり編集・削除できる（pending として扱われるため）。
 * - 請求書本体は削除しない（1 請求書に複数の請求予定が束ねられている場合があるため）。
 *   重複請求を避けるには、利用者が請求書一覧側で確認・削除する。
 * - 改ざん防止トリガ protect_confirmed_billing_draft は amount/projectId/customerId の
 *   変更のみを禁止しており、status/invoiceId の変更は許可するためマイグレーション不要。
 */
export async function POST(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const existing = await prisma.billingDraft.findUnique({ where: { id: params.id } });
        if (!existing) return notFoundResponse('請求予定');

        if (existing.deletedAt) {
            return errorResponse('削除済みの請求予定は確定解除できません', 400);
        }
        if (existing.status !== 'confirmed') {
            return errorResponse('確定済みの請求予定のみ確定解除できます', 400);
        }

        const updated = await prisma.billingDraft.update({
            where: { id: params.id },
            data: { status: 'pending', invoiceId: null },
            include: billingDraftInclude,
        });

        return NextResponse.json(formatBillingDraft(updated), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求予定の確定解除', error);
    }
}
