import { NextRequest, NextResponse } from 'next/server';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { fetchProfitDashboardData, fetchDashboardFilterOptions, type DashboardFilters } from '@/lib/profitDashboard';

function parseList(v: string | null): string[] | undefined {
    if (!v) return undefined;
    const arr = v.split(',').map(s => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
}

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(request.url);

        if (searchParams.get('options') === '1') {
            const options = await fetchDashboardFilterOptions();
            return NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } });
        }

        const filters: DashboardFilters = {
            status: searchParams.get('status') || 'all',
            dateFrom: searchParams.get('dateFrom') || undefined,
            dateTo: searchParams.get('dateTo') || undefined,
            customerNames: parseList(searchParams.get('customers')),
            foremanIds: parseList(searchParams.get('foremen')),
            constructionTypeIds: parseList(searchParams.get('types')),
        };

        const data = await fetchProfitDashboardData(filters);

        const projects = data.projects.map(p => ({
            ...p,
            updatedAt: p.updatedAt.toISOString(),
        }));

        return NextResponse.json(
            {
                projects,
                summary: data.summary,
                byCustomer: data.byCustomer,
                byConstructionType: data.byConstructionType,
                byForeman: data.byForeman,
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('利益ダッシュボード取得', error);
    }
}
