'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useNavigation } from '@/contexts/NavigationContext';
import { useSession } from 'next-auth/react';
import ScheduleViewTabs, { ScheduleView } from './Schedule/ScheduleViewTabs';

// 簡易ローディングコンポーネント
function LoadingSpinner() {
    return (
        <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
    );
}

// Dynamic Imports
const WeeklyCalendar = dynamic(() => import('./Calendar/WeeklyCalendar'), {
    loading: () => <LoadingSpinner />,
});
const AssignmentTable = dynamic(() => import('./Schedule/AssignmentTable'), {
    loading: () => <LoadingSpinner />,
});
const SettingsPage = dynamic(() => import('@/app/(master)/settings/page'), {
    loading: () => <LoadingSpinner />,
});
const ProjectMasterListPage = dynamic(() => import('@/app/(master)/project-masters/page'), {
    loading: () => <LoadingSpinner />,
});
const EstimateListPage = dynamic(() => import('@/app/(finance)/estimates/page'), {
    loading: () => <LoadingSpinner />,
});
const InvoiceListPage = dynamic(() => import('@/app/(finance)/invoices/page'), {
    loading: () => <LoadingSpinner />,
});
const CustomersPage = dynamic(() => import('@/app/(master)/customers/page'), {
    loading: () => <LoadingSpinner />,
});
const DailyReportPage = dynamic(() => import('@/app/(calendar)/daily-reports/page'), {
    loading: () => <LoadingSpinner />,
});
const ProfitDashboardWrapper = dynamic(() => import('@/app/(standalone)/profit-dashboard/components/ProfitDashboardWrapper'), {
    loading: () => <LoadingSpinner />,
});

// Placeholder component for未実装 pages
function PlaceholderPage({ title }: { title: string }) {
    return (
        <div className="flex items-center justify-center h-full">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
                <p className="text-gray-600">この機能は現在開発中です</p>
            </div>
        </div>
    );
}

export default function MainContent() {
    const { activePage } = useNavigation();
    const { data: session } = useSession();
    const [scheduleView, setScheduleView] = useState<ScheduleView>('calendar');

    const userRole = session?.user?.role;
    const userId = session?.user?.id;

    // Render content based on active page
    const renderContent = () => {
        switch (activePage) {
            case 'schedule':
                // workerロールの場合は手配表のみ表示（タブなし）
                if (userRole === 'worker') {
                    return (
                        <div className="flex-1 min-h-0">
                            <AssignmentTable userRole="worker" userTeamId={userId} />
                        </div>
                    );
                }
                // partnerロールの場合は週間カレンダーのみ表示（閲覧のみ、自分のチームのみ）
                if (userRole === 'partner') {
                    return (
                        <div className="flex-1 min-h-0">
                            <WeeklyCalendar partnerMode={true} partnerId={userId} />
                        </div>
                    );
                }
                // Schedule management (calendar/assignment view)
                return (
                    <>
                        <ScheduleViewTabs
                            activeView={scheduleView}
                            onViewChange={setScheduleView}
                        />
                        <div className="flex-1 min-h-0">
                            {scheduleView === 'calendar' ? (
                                <WeeklyCalendar />
                            ) : (
                                <AssignmentTable />
                            )}
                        </div>
                    </>
                );

            case 'settings':
                return <SettingsPage />;

            case 'project-masters':
                return <ProjectMasterListPage />;

            case 'estimates':
                return <EstimateListPage />;

            case 'invoices':
                return <InvoiceListPage />;

            case 'reports':
                return <DailyReportPage />;

            case 'profit-dashboard':
                return <ProfitDashboardWrapper />;

            case 'orders':
                return <PlaceholderPage title="発注書" />;

            case 'partners':
                return <PlaceholderPage title="協力会社" />;

            case 'customers':
                return <CustomersPage />;

            case 'company':
                return <PlaceholderPage title="自社情報" />;

            default:
                return <PlaceholderPage title="ページが見つかりません" />;
        }
    };

    return (
        <main className="
            fixed top-0 bottom-0 bg-slate-50 overflow-auto

            /* Mobile: Full width with top padding for header */
            left-0 right-0 pt-16

            /* Desktop: Offset by sidebar width, no top padding */
            lg:left-64 lg:pt-0 lg:right-0
        ">
            <div className={`${activePage === 'schedule' ? 'p-4 sm:p-6 h-full flex flex-col' : 'p-4 sm:p-6'} w-full min-w-0`}>
                {renderContent()}
            </div>
        </main>
    );
}
