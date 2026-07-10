import { NextResponse } from 'next/server';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { fetchMonthlySales } from '@/lib/profitDashboard';

/**
 * GET → { monthlySales }（直近12ヶ月の月次売上 trend・税込）。
 * 旧: 案件一覧・summary・顧客/工事種別/職長別集計・?options=1（フィルタ選択肢）は
 * ダッシュボード再編（月次中心化・kei決定 2026-07-10）で廃止した。
 * 期間別の売上・原価・粗利の内訳は /api/profit-dashboard/monthly-detail が担う。
 */
export async function GET() {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const monthlySales = await fetchMonthlySales();
        return NextResponse.json({ monthlySales }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('利益ダッシュボード取得', error);
    }
}
