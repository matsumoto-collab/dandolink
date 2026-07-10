import { NextRequest, NextResponse } from 'next/server';
import { requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { fetchMonthlyAssigneeBreakdown } from '@/lib/profitDashboard';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * GET ?year=&month=&axis=assignee|customer&period=month|year|range&endYear=&endMonth=
 * → 当該期間に請求のあった案件の 担当者別/顧客別 売上・原価・粗利（案件明細つき）。
 * period=range は開始 (year,month) 〜 終了 (endYear,endMonth) の任意月範囲（最大24ヶ月）。
 *
 * 原価は繰越方式（computeProjectCosts の cutoffs）で表示のみ。手修正は案件詳細の利益タブに一本化したため、
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
        const periodParam = searchParams.get('period');
        const period = periodParam === 'year' ? 'year' : periodParam === 'range' ? 'range' : 'month';

        let endYear: number | undefined;
        let endMonth: number | undefined;
        if (period === 'range') {
            endYear = Number(searchParams.get('endYear'));
            endMonth = Number(searchParams.get('endMonth'));
            if (!Number.isInteger(endYear) || !Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) {
                return validationErrorResponse('endYear/endMonth が不正です');
            }
            const spanMonths = (endYear * 12 + endMonth) - (year * 12 + month) + 1;
            if (spanMonths < 1 || spanMonths > 24) {
                return validationErrorResponse('期間は開始月以降・最大24ヶ月で指定してください');
            }
        }

        const data = await fetchMonthlyAssigneeBreakdown({ year, month, axis, period, endYear, endMonth });
        return NextResponse.json(data, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('月次内訳の取得', error);
    }
}
