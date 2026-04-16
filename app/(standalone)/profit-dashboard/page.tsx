import { Suspense } from 'react';
import { fetchProfitDashboardData } from '@/lib/profitDashboard';
import ProfitDashboardClient, { type SerializedProjectProfit } from './components/ProfitDashboardClient';
import ProfitDashboardLoading from './loading';

interface Props {
    searchParams: Promise<{ status?: string }>;
}

async function ProfitDashboardContent({ status }: { status: string }) {
    const data = await fetchProfitDashboardData(status);

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
            currentStatus={status}
        />
    );
}

export default async function ProfitDashboardPage({ searchParams }: Props) {
    const resolvedParams = await searchParams;
    const status = resolvedParams.status || 'active';

    return (
        <Suspense fallback={<ProfitDashboardLoading />}>
            <ProfitDashboardContent status={status} />
        </Suspense>
    );
}
