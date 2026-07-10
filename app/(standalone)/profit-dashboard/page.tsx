import { Suspense } from 'react';
import { fetchMonthlySales } from '@/lib/profitDashboard';
import ProfitDashboardClient from './components/ProfitDashboardClient';
import ProfitDashboardLoading from './loading';

// DB を読む動的ページ（ビルド時プリレンダー禁止）。旧 searchParams フィルタは
// ダッシュボード再編（月次中心化）で廃止したため、明示指定が必要になった。
export const dynamic = 'force-dynamic';

async function ProfitDashboardContent() {
    const monthlySales = await fetchMonthlySales();
    return <ProfitDashboardClient monthlySales={monthlySales} />;
}

export default async function ProfitDashboardPage() {
    return (
        <Suspense fallback={<ProfitDashboardLoading />}>
            <ProfitDashboardContent />
        </Suspense>
    );
}
