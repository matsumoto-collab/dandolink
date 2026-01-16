import { Suspense } from 'react';
import { fetchProfitDashboardData } from '@/lib/profitDashboard';
import ProfitDashboardClient from './components/ProfitDashboardClient';
import ProfitDashboardLoading from './loading';

interface Props {
    searchParams: Promise<{ status?: string }>;
}

// データ取得を行うServer Component
async function ProfitDashboardContent({ status }: { status: string }) {
    const data = await fetchProfitDashboardData(status);

    // Date型をシリアライズ可能な形式に変換
    const serializedProjects = data.projects.map(p => ({
        ...p,
        updatedAt: p.updatedAt.toISOString(),
    }));

    return (
        <ProfitDashboardClient
            projects={serializedProjects as any}
            summary={data.summary}
            currentStatus={status}
        />
    );
}

// メインページ（Server Component）
export default async function ProfitDashboardPage({ searchParams }: Props) {
    const resolvedParams = await searchParams;
    const status = resolvedParams.status || 'active';

    return (
        <Suspense fallback={<ProfitDashboardLoading />}>
            <ProfitDashboardContent status={status} />
        </Suspense>
    );
}
