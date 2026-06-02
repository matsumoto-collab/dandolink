import { NextRequest, NextResponse } from 'next/server';
import { requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { fetchMonthlyAssigneeBreakdown } from '@/lib/profitDashboard';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * GET ?year=&month=&axis=assignee|customer&period=month|year
 * → 当該期間に請求のあった案件の 担当者別/顧客別 売上・原価・粗利（案件明細つき）。
 *
 * 原価は案件の確定原価（computeProjectCosts）で表示のみ。手修正は案件詳細の利益タブに一本化したため、
 * この画面からの保存（旧 PUT）は廃止した。
 */
export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const year = Number(searchParams.get('year'));
        const month = Number(searchParams.get('month'));
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
            return validationErrorResponse('year/month が不正です');
        }
        const axis = searchParams.get('axis') === 'customer' ? 'customer' : 'assignee';
        const period = searchParams.get('period') === 'year' ? 'year' : 'month';

        const data = await fetchMonthlyAssigneeBreakdown({ year, month, axis, period });
        return NextResponse.json(data, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('月次内訳の取得', error);
    }
}
