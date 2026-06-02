import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    notFoundResponse,
    validationErrorResponse,
    serverErrorResponse,
} from '@/lib/api/utils';
import type { BillingDecision } from '@/types/billingBoard';

const VALID_DECISIONS: BillingDecision[] = ['pending', 'hold', 'excluded'];

/**
 * PATCH /api/project-masters/[id]/billing-decision
 *
 * 案件の請求判断（'pending'=判断待ち / 'hold'=保留 / 'excluded'=対象外）を更新する。
 * 「請求する」は別途 BillingDraft 作成（POST /api/billing-drafts）で表現するため、ここでは扱わない。
 * 権限：admin / manager のみ。
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } },
) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json().catch(() => ({}));
        const decision = (body as { decision?: unknown }).decision;
        if (typeof decision !== 'string' || !VALID_DECISIONS.includes(decision as BillingDecision)) {
            return validationErrorResponse('decision は pending / hold / excluded のいずれかを指定してください');
        }

        const pm = await prisma.projectMaster.findUnique({
            where: { id: params.id },
            select: { id: true },
        });
        if (!pm) return notFoundResponse('案件マスター');

        const updated = await prisma.projectMaster.update({
            where: { id: params.id },
            data: {
                billingDecision: decision,
                billingDecisionBy: session!.user.id,
                billingDecisionAt: new Date(),
            },
            select: {
                id: true,
                billingDecision: true,
                billingDecisionBy: true,
                billingDecisionAt: true,
            },
        });

        return NextResponse.json(updated, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求判断の更新', error);
    }
}
