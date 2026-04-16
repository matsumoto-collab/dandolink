import { NextRequest, NextResponse } from 'next/server';
import { requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { fetchProfitDashboardData } from '@/lib/profitDashboard';

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status') || 'all';

        const data = await fetchProfitDashboardData(status);

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
                mode: 'full',
            },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('利益ダッシュボード取得', error);
    }
}
