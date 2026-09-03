import { NextRequest, NextResponse } from 'next/server';
import { serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations';
import { orderBacklogCandidatesQuerySchema } from '@/lib/validations/orderBacklog';
import { buildOrderBacklogCandidates } from '@/lib/orderBacklog/candidates';
import { requireOrderBacklogAdmin } from '../_shared';

/**
 * GET /api/order-backlog/candidates?asOf=YYYY-MM-DD[&taxMode=inclusive|exclusive][&projectMasterIds=a,b]
 *
 * 受注明細書の候補行を作って返す（仕様書 §3.6・admin 限定）。
 * `projectMasterIds` を渡すと抽出条件を無視してその案件だけ計算する（画面の「案件を追加」用）。
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireOrderBacklogAdmin();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const idsParam = searchParams.get('projectMasterIds');
        const parsed = validateRequest(orderBacklogCandidatesQuerySchema, {
            asOf: searchParams.get('asOf') ?? '',
            taxMode: searchParams.get('taxMode') || undefined,
            projectMasterIds: idsParam
                ? idsParam
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                : undefined,
        });
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);

        const result = await buildOrderBacklogCandidates(parsed.data);
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('受注明細書の候補取得', error);
    }
}
