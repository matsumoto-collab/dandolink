import { Suspense } from 'react';
import { fetchProfitDashboardData, fetchDashboardFilterOptions, type DashboardFilters } from '@/lib/profitDashboard';
import ProfitDashboardClient, { type SerializedProjectProfit } from './components/ProfitDashboardClient';
import ProfitDashboardLoading from './loading';

interface Props {
    searchParams: Promise<{
        status?: string;
        dateFrom?: string;
        dateTo?: string;
        customers?: string;
        foremen?: string;
        types?: string;
    }>;
}

async function ProfitDashboardContent({ filters }: { filters: DashboardFilters }) {
    const [data, options] = await Promise.all([
        fetchProfitDashboardData(filters),
        fetchDashboardFilterOptions(),
    ]);

    const serializedProjects: SerializedProjectProfit[] = data.projects.map(p => ({
        ...p,
        updatedAt: p.updatedAt.toISOString(),
    }));

    return (
        <ProfitDashboardClient
            projects={serializedProjects}
            summary={data.summary}
            byCustomer={data.byCustomer}
            byConstructionType={data.byConstructionType}
            byForeman={data.byForeman}
            filterOptions={options}
            initialFilters={filters}
        />
    );
}

export default async function ProfitDashboardPage({ searchParams }: Props) {
    const sp = await searchParams;
    const split = (v?: string) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined);
    const filters: DashboardFilters = {
        status: sp.status || 'active',
        dateFrom: sp.dateFrom,
        dateTo: sp.dateTo,
        customerNames: split(sp.customers),
        foremanIds: split(sp.foremen),
        constructionTypeIds: split(sp.types),
    };

    return (
        <Suspense fallback={<ProfitDashboardLoading />}>
            <ProfitDashboardContent filters={filters} />
        </Suspense>
    );
}
