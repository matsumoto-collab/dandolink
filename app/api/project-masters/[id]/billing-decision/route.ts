import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    notFoundResponse,
    validationErrorResponse,
    serverErrorResponse,
} from '@/lib/api/utils';
import type { BillingDecision } from '@/types/billingBoard';
import { currentPeriodKeyJst } from '@/lib/closingDay';

const VALID_DECISIONS: BillingDecision[] = ['pending', 'hold', 'excluded', 'billed'];

/** periodKey は "YYYY-MM"（締め基準月）形式か。 */
function isPeriodKey(s: unknown): s is string {
    return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
}

/**
 * PATCH /api/project-masters/[id]/billing-decision
 *
 * 案件の請求判断を「案件 × 締め月(periodKey="YYYY-MM")」ごとに更新する（ProjectBillingDecision）。
 * decision: 'pending'=判断待ち / 'hold'=保留 / 'excluded'=対象外 / 'billed'=請求済み。
 * 'pending' は該当月のレコードを削除（＝判断待ち）。それ以外は複合キーで upsert。月をまたいで貼り付かない。
 * 'billed' は「手動で請求済みにした」マーク（実請求の有無に依らずボードの「請求済み」タブへ送る）。
 * periodKey 未指定は当月(JST)にフォールバック。「請求する」はここでは扱わない（請求対象→請求書発行で表現）。
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
            return validationErrorResponse('decision は pending / hold / excluded / billed のいずれかを指定してください');
        }

        // periodKey（締め基準月 "YYYY-MM"）。未指定は当月(JST)にフォールバック。形式不正は 400。
        const rawPeriodKey = (body as { periodKey?: unknown }).periodKey;
        if (rawPeriodKey !== undefined && rawPeriodKey !== null && !isPeriodKey(rawPeriodKey)) {
            return validationErrorResponse('periodKey は YYYY-MM 形式で指定してください');
        }
        const periodKey = isPeriodKey(rawPeriodKey) ? rawPeriodKey : currentPeriodKeyJst();

        const pm = await prisma.projectMaster.findUnique({
            where: { id: params.id },
            select: { id: true },
        });
        if (!pm) return notFoundResponse('案件マスター');

        // 判断は「案件 × 締め月(periodKey)」ごとに ProjectBillingDecision に保持する。
        // 'pending'(判断待ち) はレコード無しで表現＝該当 periodKey の行を削除する。
        // それ以外(hold/excluded/billed)は複合キーで upsert。旧 ProjectMaster.billingDecision は更新しない（凍結）。
        if (decision === 'pending') {
            await prisma.projectBillingDecision.deleteMany({
                where: { projectMasterId: params.id, periodKey },
            });
        } else {
            await prisma.projectBillingDecision.upsert({
                where: { projectMasterId_periodKey: { projectMasterId: params.id, periodKey } },
                update: { decision, decidedBy: session!.user.id, decidedAt: new Date() },
                create: {
                    projectMasterId: params.id,
                    periodKey,
                    decision,
                    decidedBy: session!.user.id,
                    decidedAt: new Date(),
                },
            });
        }

        return NextResponse.json(
            { projectMasterId: params.id, periodKey, decision },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('請求判断の更新', error);
    }
}
