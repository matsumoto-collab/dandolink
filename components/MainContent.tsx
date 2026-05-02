'use client';

import React, { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useNavigation, PageType } from '@/contexts/NavigationContext';
import { useSession } from 'next-auth/react';
import { ChevronRight } from 'lucide-react';
import ScheduleViewTabs, { ScheduleView } from './Schedule/ScheduleViewTabs';

const VALID_PAGES: PageType[] = [
    'schedule', 'my-schedule', 'project-masters', 'reports', 'attendance',
    'profit-dashboard', 'estimates', 'invoices', 'orders',
    'partners', 'customers', 'company',
    'materials', 'inventory', 'loading-list', 'settings', 'chat',
];

// 簡易ローディングコンポーネント
function LoadingSpinner() {
    return (
        <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
        </div>
    );
}

// Dynamic Imports
const WeeklyCalendar = dynamic(() => import('./Calendar/WeeklyCalendar'), {
    loading: () => <LoadingSpinner />,
});
const OverviewCalendar = dynamic(() => import('./Calendar/OverviewCalendar'), {
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
const CompanyInfoSettings = dynamic(() => import('@/components/Settings/CompanyInfoSettings'), {
    loading: () => <LoadingSpinner />,
});
const MaterialRequisitionPage = dynamic(() => import('@/components/Materials/MaterialRequisitionPage'), {
    loading: () => <LoadingSpinner />,
});
const InventoryPage = dynamic(() => import('@/components/Materials/InventoryPage'), {
    loading: () => <LoadingSpinner />,
});
const LoadingListPage = dynamic(() => import('@/components/Materials/LoadingListPage'), {
    loading: () => <LoadingSpinner />,
});
const MySchedulePage = dynamic(() => import('@/components/MySchedule/MySchedulePage'), {
    loading: () => <LoadingSpinner />,
});
const AttendancePage = dynamic(() => import('@/components/Attendance/AttendancePage'), {
    loading: () => <LoadingSpinner />,
});
const ChatPage = dynamic(() => import('@/components/Chat/ChatPage'), {
    loading: () => <LoadingSpinner />,
});

// Placeholder component for未実装 pages
function PlaceholderPage({ title }: { title: string }) {
    return (
        <div className="flex items-center justify-center h-full">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">{title}</h2>
                <p className="text-slate-600">この機能は現在開発中です</p>
            </div>
        </div>
    );
}

export default function MainContent() {
    const { activePage, setActivePage, isSidebarCollapsed, toggleSidebarCollapse } = useNavigation();
    const { data: session } = useSession();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const [scheduleView, setScheduleView] = useState<ScheduleView>('calendar');

    // 通知などからのディープリンク:
    //   ?page=schedule&view=assignment    → 手配表タブを開く
    //   ?page=project-masters&pmId=...    → 案件詳細モーダルを開く（page側で処理）
    // page/view は処理後にURLから除去するが、pmId/scrollTo は遷移先ページが消費するため残す
    useEffect(() => {
        const pageParam = searchParams?.get('page');
        const viewParam = searchParams?.get('view');
        if (!pageParam) return;
        let consumed = false;
        if (VALID_PAGES.includes(pageParam as PageType)) {
            setActivePage(pageParam as PageType);
            consumed = true;
        }
        if (pageParam === 'schedule' && (viewParam === 'calendar' || viewParam === 'overview' || viewParam === 'assignment')) {
            setScheduleView(viewParam);
            consumed = true;
        }
        if (consumed) {
            const next = new URLSearchParams(searchParams?.toString() || '');
            next.delete('page');
            next.delete('view');
            const qs = next.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname);
        }
    }, [searchParams, setActivePage, router, pathname]);
    const [calendarNav, setCalendarNav] = useState<{
        goToPreviousWeek: () => void;
        goToNextWeek: () => void;
        goToPreviousDay: () => void;
        goToNextDay: () => void;
        goToToday: () => void;
    } | null>(null);
    const handleNavigationReady = useCallback((nav: typeof calendarNav) => {
        setCalendarNav(nav);
    }, []);

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
                                <WeeklyCalendar onNavigationReady={handleNavigationReady} />
                            ) : scheduleView === 'overview' ? (
                                <OverviewCalendar onNavigationReady={handleNavigationReady} />
                            ) : (
                                <AssignmentTable />
                            )}
                        </div>
                    </>
                );

            case 'settings':
                return <SettingsPage />;

            case 'my-schedule':
                return <MySchedulePage />;

            case 'project-masters':
                return <ProjectMasterListPage />;

            case 'estimates':
                return <EstimateListPage />;

            case 'invoices':
                return <InvoiceListPage />;

            case 'reports':
                return <DailyReportPage />;

            case 'attendance':
                return <AttendancePage />;

            case 'chat':
                return <ChatPage />;

            case 'profit-dashboard':
                return <ProfitDashboardWrapper />;

            case 'orders':
                return <PlaceholderPage title="発注書" />;

            case 'partners':
                return <PlaceholderPage title="協力会社" />;

            case 'materials':
                return <MaterialRequisitionPage />;

            case 'inventory':
                return <InventoryPage />;

            case 'loading-list':
                return <LoadingListPage />;

            case 'customers':
                return <CustomersPage />;

            case 'company':
                return <CompanyInfoSettings />;

            default:
                return <PlaceholderPage title="ページが見つかりません" />;
        }
    };

    return (
        <>
            <main className="
                fixed top-0 bottom-0 bg-slate-50 overflow-auto

                /* Mobile: Full width with top padding for header */
                left-0 right-0 pt-16

                /* Desktop: Offset by sidebar width, no top padding */
                lg:left-48 lg:pt-0 lg:right-0

                pwa-main-safe
            ">
                <div key={activePage} className={`${['schedule', 'estimates', 'project-masters', 'reports', 'invoices', 'customers', 'chat'].includes(activePage) ? 'p-4 sm:p-6 h-full flex flex-col' : 'p-4 sm:p-6'} w-full min-w-0 animate-page-enter`}>
                    {renderContent()}
                </div>
            </main>

            {/* サイドバー折りたたみ中のフローティング展開ボタン (デスクトップのみ) */}
            {isSidebarCollapsed && (
                <button
                    onClick={toggleSidebarCollapse}
                    className="hidden lg:flex fixed left-0 top-3 z-[60] items-center justify-center w-7 h-12 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded-r-lg shadow-lg border border-l-0 border-slate-700 transition-colors"
                    aria-label="サイドバーを開く"
                    title="サイドバーを開く"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            )}
        </>
    );
}
