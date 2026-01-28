'use client';

import React, { useState } from 'react';
import { useNavigation } from '@/contexts/NavigationContext';
import { useSession } from 'next-auth/react';
import WeeklyCalendar from './Calendar/WeeklyCalendar';
import ScheduleViewTabs, { ScheduleView } from './Schedule/ScheduleViewTabs';
import AssignmentTable from './Schedule/AssignmentTable';
import SettingsPage from '@/app/(master)/settings/page';
import ProjectMasterListPage from '@/app/(master)/project-masters/page';
import EstimateListPage from '@/app/(finance)/estimates/page';
import InvoiceListPage from '@/app/(finance)/invoices/page';
import CustomersPage from '@/app/(master)/customers/page';
import DailyReportPage from '@/app/(calendar)/daily-reports/page';
import ProfitDashboardWrapper from '@/app/(standalone)/profit-dashboard/components/ProfitDashboardWrapper';
import { CalendarProviders } from '@/app/providers/CalendarProviders';
import { FinanceProviders } from '@/app/providers/FinanceProviders';
import { MasterProviders } from '@/app/providers/MasterProviders';
import { ProfitDashboardProvider } from '@/contexts/ProfitDashboardContext';

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
                        <CalendarProviders>
                            <div className="flex-1 min-h-0">
                                <AssignmentTable userRole="worker" userTeamId={userId} />
                            </div>
                        </CalendarProviders>
                    );
                }
                // partnerロールの場合は週間カレンダーのみ表示（閲覧のみ、自分のチームのみ）
                if (userRole === 'partner') {
                    return (
                        <CalendarProviders>
                            <div className="flex-1 min-h-0">
                                <WeeklyCalendar partnerMode={true} partnerId={userId} />
                            </div>
                        </CalendarProviders>
                    );
                }
                // Schedule management (calendar/assignment view)
                return (
                    <CalendarProviders>
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
                    </CalendarProviders>
                );

            case 'settings':
                // Settings page (master data management)
                return <MasterProviders><SettingsPage /></MasterProviders>;

            case 'project-masters':
                return <MasterProviders><ProjectMasterListPage /></MasterProviders>;

            case 'estimates':
                return <FinanceProviders><EstimateListPage /></FinanceProviders>;

            case 'invoices':
                return <FinanceProviders><InvoiceListPage /></FinanceProviders>;

            case 'reports':
                return <CalendarProviders><DailyReportPage /></CalendarProviders>;

            case 'profit-dashboard':
                return <ProfitDashboardProvider><ProfitDashboardWrapper /></ProfitDashboardProvider>;

            case 'orders':
                return <PlaceholderPage title="発注書" />;

            case 'partners':
                return <PlaceholderPage title="協力会社" />;

            case 'customers':
                return <MasterProviders><CustomersPage /></MasterProviders>;

            case 'company':
                return <PlaceholderPage title="自社情報" />;

            default:
                return <PlaceholderPage title="ページが見つかりません" />;
        }
    };

    return (
        <main className="
            fixed top-0 bottom-0 bg-gradient-to-br from-slate-50 via-white to-slate-100 overflow-auto
            
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
