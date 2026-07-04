'use client';

import React, { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useNavigation, PageType } from '@/contexts/NavigationContext';
import { useSession } from 'next-auth/react';
import { ChevronRight } from 'lucide-react';
import { ScheduleView } from './Schedule/ScheduleViewTabs';
import ScheduleToolbar from './Schedule/ScheduleToolbar';
import { isManagerOrAbove } from '@/utils/permissions';

const VALID_PAGES: PageType[] = [
    'schedule', 'my-schedule', 'project-masters', 'reports', 'attendance',
    'profit-dashboard', 'estimates', 'invoices', 'billing-drafts', 'billing-board',
    'partners', 'customers', 'company',
    'materials', 'inventory', 'loading-list', 'material-returns', 'settings', 'chat',
    'payment-schedules', 'receipts', 'payees', 'partner-work-volume',
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
const BillingDraftListPage = dynamic(() => import('@/app/(finance)/billing-drafts/page'), {
    loading: () => <LoadingSpinner />,
});
const BillingBoardPage = dynamic(() => import('@/app/(finance)/billing-board/page'), {
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
const MaterialReturnPage = dynamic(() => import('@/components/Materials/MaterialReturnPage'), {
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
const PaymentSchedulesPage = dynamic(() => import('@/app/(finance)/payment-schedules/page'), {
    loading: () => <LoadingSpinner />,
});
const ReceiptsPage = dynamic(() => import('@/app/(finance)/receipts/page'), {
    loading: () => <LoadingSpinner />,
});
const PayeesPage = dynamic(() => import('@/app/(master)/payees/page'), {
    loading: () => <LoadingSpinner />,
});
const PartnerScheduleScreen = dynamic(() => import('./PartnerSchedule/PartnerScheduleScreen'), {
    loading: () => <LoadingSpinner />,
});
const PartnerWorkVolumePage = dynamic(() => import('./PartnerWorkVolume/PartnerWorkVolumePage'), {
    loading: () => <LoadingSpinner />,
});
const ScheduleHistoryPanel = dynamic(() => import('./Calendar/ScheduleHistoryPanel'), {
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
    // page/view は処理後にURLから除去するが、pmId/scrollTo/pmEdit が含まれる場合は
    // 遷移先ページ側の URL 掃除に一任する（親子で同時に router.replace すると
    // 子→親の順で後勝ちになり、モバイルで pmId が URL に残って残像表示を引き起こすため）。
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
        const hasChildDeepLinkParams =
            searchParams?.has('pmId') || searchParams?.has('scrollTo') || searchParams?.has('pmEdit');
        if (consumed && !hasChildDeepLinkParams) {
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
    const [openSearch, setOpenSearch] = useState<(() => void) | null>(null);
    const handleSearchReady = useCallback((opener: () => void) => {
        setOpenSearch(() => opener);
    }, []);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const canViewHistory = isManagerOrAbove(session?.user);

    const userRole = session?.user?.role;
    const userId = session?.user?.id;

    // アクセシビリティ/SEO 向けのページタイトル（h1 として読み上げソフトに伝える）
    const pageTitleMap: Record<PageType, string> = {
        'schedule': '工程管理',
        'my-schedule': 'マイスケジュール',
        'project-masters': '案件マスタ',
        'reports': '日報',
        'attendance': '出勤簿',
        'profit-dashboard': '粗利ダッシュボード',
        'estimates': '見積書',
        'invoices': '請求書',
        'billing-drafts': '請求予定',
        'billing-board': '請求待ち',
        'partners': '協力会社',
        'customers': '取引先',
        'company': '会社情報',
        'materials': '資材発注',
        'inventory': '在庫',
        'loading-list': '積み込みリスト',
        'material-returns': '材料返却',
        'settings': '設定',
        'chat': 'チャット',
        'payment-schedules': '支払予定',
        'receipts': '領収書',
        'payees': '支払先',
        'partner-work-volume': '協力業者出来高表',
    };
    const pageTitle = pageTitleMap[activePage] ?? 'DandoLink';

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
                            <PartnerScheduleScreen weeklyPartnerId={userId!} />
                        </div>
                    );
                }
                // partner_memberロールの場合は親協力会社をスコープに今日明日/週間を表示
                if (userRole === 'partner_member') {
                    const parentCompanyId = session?.user?.companyId;
                    if (!parentCompanyId) {
                        return (
                            <div className="flex-1 min-h-0 flex items-center justify-center">
                                <div className="text-center">
                                    <h2 className="text-xl font-bold text-slate-900 mb-2">所属会社が設定されていません</h2>
                                    <p className="text-slate-600">管理者に所属協力会社の設定を依頼してください。</p>
                                </div>
                            </div>
                        );
                    }
                    return (
                        <div className="flex-1 min-h-0">
                            <PartnerScheduleScreen weeklyPartnerId={parentCompanyId} />
                        </div>
                    );
                }
                // Schedule management (calendar/assignment view)
                return (
                    <>
                        <ScheduleToolbar
                            activeView={scheduleView}
                            onViewChange={setScheduleView}
                            onPrevWeek={calendarNav?.goToPreviousWeek}
                            onNextWeek={calendarNav?.goToNextWeek}
                            onPrevDay={calendarNav?.goToPreviousDay}
                            onNextDay={calendarNav?.goToNextDay}
                            onToday={calendarNav?.goToToday}
                            onOpenSearch={scheduleView === 'calendar' && openSearch ? openSearch : undefined}
                            onOpenHistory={canViewHistory ? () => setIsHistoryOpen(true) : undefined}
                        />
                        <div className="flex-1 min-h-0">
                            {scheduleView === 'calendar' ? (
                                <WeeklyCalendar
                                    onNavigationReady={handleNavigationReady}
                                    onSearchReady={handleSearchReady}
                                />
                            ) : scheduleView === 'overview' ? (
                                <OverviewCalendar onNavigationReady={handleNavigationReady} />
                            ) : (
                                <AssignmentTable userRole={userRole} userTeamId={userId} />
                            )}
                        </div>
                        {canViewHistory && (
                            <ScheduleHistoryPanel
                                isOpen={isHistoryOpen}
                                onClose={() => setIsHistoryOpen(false)}
                            />
                        )}
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

            case 'billing-board':
                if (userRole !== 'admin' && userRole !== 'manager') {
                    return <PlaceholderPage title="アクセス権限がありません" />;
                }
                return <BillingBoardPage />;

            case 'billing-drafts':
                if (userRole !== 'admin' && userRole !== 'manager') {
                    return <PlaceholderPage title="アクセス権限がありません" />;
                }
                return <BillingDraftListPage />;

            case 'reports':
                return <DailyReportPage />;

            case 'attendance':
                return <AttendancePage />;

            case 'chat':
                return <ChatPage />;

            case 'profit-dashboard':
                return <ProfitDashboardWrapper />;

            case 'partners':
                return <PlaceholderPage title="協力会社" />;

            case 'materials':
                return <MaterialRequisitionPage />;

            case 'inventory':
                return <InventoryPage />;

            case 'loading-list':
                return <LoadingListPage />;

            case 'material-returns':
                return <MaterialReturnPage />;

            case 'customers':
                return <CustomersPage />;

            case 'payment-schedules':
                if (userRole !== 'admin') {
                    return <PlaceholderPage title="アクセス権限がありません" />;
                }
                return <PaymentSchedulesPage />;

            case 'receipts':
                if (userRole !== 'admin' && userRole !== 'manager') {
                    return <PlaceholderPage title="アクセス権限がありません" />;
                }
                return <ReceiptsPage />;

            case 'payees':
                if (userRole !== 'admin') {
                    return <PlaceholderPage title="アクセス権限がありません" />;
                }
                return <PayeesPage />;

            case 'company':
                return <CompanyInfoSettings />;

            case 'partner-work-volume':
                if (
                    userRole !== 'admin' &&
                    userRole !== 'manager' &&
                    userRole !== 'partner'
                ) {
                    return <PlaceholderPage title="アクセス権限がありません" />;
                }
                return <PartnerWorkVolumePage />;

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
                <div key={activePage} className={`${activePage === 'schedule' ? 'px-4 sm:px-6 pt-1 pb-2 h-full flex flex-col' : ['estimates', 'project-masters', 'reports', 'attendance', 'invoices', 'billing-drafts', 'billing-board', 'customers', 'chat', 'payment-schedules', 'receipts', 'payees', 'partner-work-volume', 'materials'].includes(activePage) ? 'p-4 sm:p-6 h-full flex flex-col' : 'p-4 sm:p-6'} w-full min-w-0`}>
                    {/* 画面読み上げソフト・SEO 向け h1（視覚的には隠す） */}
                    <h1 className="sr-only">{pageTitle} - DandoLink</h1>
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
