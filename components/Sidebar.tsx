'use client';

import React, { useState } from 'react';
import { useNavigation, PageType } from '@/contexts/NavigationContext';
import { useSession, signOut } from 'next-auth/react';
import {
    ChevronRight,
    ChevronLeft,
    X,
} from 'lucide-react';
import NotificationsInbox from '@/components/Notifications/NotificationsInbox';
import { useChatStore } from '@/stores/chatStore';
import { APP_NAME, APP_LOGO } from '@/lib/branding';
import { useChatRoomsRealtime } from '@/hooks/useChatRealtime';

interface NavItem {
    name: string;
    page: 'schedule' | 'my-schedule' | 'project-masters' | 'reports' | 'attendance' | 'profit-dashboard' | 'estimates' | 'site-surveys' | 'invoices' | 'billing-drafts' | 'billing-board' | 'materials' | 'inventory' | 'loading-list' | 'material-returns' | 'partners' | 'customers' | 'company' | 'chat' | 'payment-schedules' | 'purchase-invoices' | 'payees' | 'partner-work-volume' | 'company-calendar' | 'safety-documents' | 'settings';
    /** このメニュー項目を表示できるロール。指定なし=全員 */
    requiredRoles?: string[];
}

interface NavSection {
    title: string;
    items: NavItem[];
}

const navigationSections: NavSection[] = [
    {
        title: '業務管理',
        items: [
            { name: 'スケジュール管理', page: 'schedule' },
            { name: 'マイ工程', page: 'my-schedule' },
            { name: 'マイカレンダー', page: 'company-calendar', requiredRoles: ['admin', 'manager'] },
            { name: '案件一覧', page: 'project-masters' },
            { name: '報告一覧', page: 'reports' },
            { name: '出勤簿', page: 'attendance' },
            { name: 'チャット', page: 'chat' },
        ],
    },
    {
        title: '書類・経理',
        items: [
            { name: '見積書', page: 'estimates' },
            { name: '請求書', page: 'invoices' },
            { name: '請求待ち', page: 'billing-board', requiredRoles: ['admin', 'manager'] },
            { name: '図面', page: 'site-surveys' },
            { name: '安全書類', page: 'safety-documents', requiredRoles: ['admin', 'manager'] },
            { name: '協力業者出来高', page: 'partner-work-volume', requiredRoles: ['admin', 'manager'] },
            { name: '仕入請求書', page: 'purchase-invoices', requiredRoles: ['admin', 'manager'] },
            { name: '支払予定', page: 'payment-schedules', requiredRoles: ['admin'] },
            { name: '利益ダッシュボード', page: 'profit-dashboard' },
        ],
    },
    {
        title: '材料管理',
        items: [
            { name: '在庫管理', page: 'inventory' },
            { name: '出庫伝票', page: 'materials' },
            { name: '返却', page: 'material-returns' },
        ],
    },
    {
        title: 'マスター・設定',
        items: [
            { name: '顧客管理', page: 'customers' },
            { name: '振込先マスター', page: 'payees', requiredRoles: ['admin'] },
            { name: '自社情報', page: 'company' },
            { name: '設定', page: 'settings' },
        ],
    },
];

export default function Sidebar() {
    const { activePage, setActivePage, isMobileMenuOpen, closeMobileMenu, toggleSidebarCollapse } = useNavigation();
    const { data: session } = useSession();
    const [isReloading, setIsReloading] = useState(false);
    const totalChatUnread = useChatStore((s) => s.totalUnread);
    const fetchRooms = useChatStore((s) => s.fetchRooms);

    // 全ページで未読バッジを即時更新するためグローバル購読
    useChatRoomsRealtime(!!session?.user?.id, session?.user?.id);

    React.useEffect(() => {
        if (session?.user?.id) {
            fetchRooms();
        }
    }, [session?.user?.id, fetchRooms]);

    // ロゴタップ: 全リロード（暗転の原因）をやめ、SPA 内でホーム（工程管理）へ遷移＋モバイルメニューを閉じる。
    // 業務データは Realtime/ポーリング/broadcast で自動更新されるため再取得は不要。
    const handleReload = () => {
        setIsReloading(true);
        setActivePage('schedule');
        closeMobileMenu();
        setTimeout(() => setIsReloading(false), 400);
    };

    const handleLogout = async () => {
        if (confirm('ログアウトしますか？')) {
            await signOut({ callbackUrl: '/login' });
        }
    };

    const handleNavigation = (page: PageType) => {
        setActivePage(page);
        closeMobileMenu(); // Close mobile menu after navigation
    };

    const getRoleBadgeColor = (role: string) => {
        switch (role) {
            case 'admin':
                return 'bg-slate-500/20 text-slate-300 ring-slate-500/30';
            case 'manager':
                return 'bg-slate-600/20 text-slate-300 ring-slate-500/30';
            case 'user':
                return 'bg-slate-600/20 text-slate-300 ring-green-500/30';
            case 'viewer':
                return 'bg-slate-500/20 text-slate-300 ring-slate-500/30';
            case 'partner_member':
                return 'bg-slate-500/20 text-slate-300 ring-slate-500/30';
            default:
                return 'bg-slate-500/20 text-slate-300 ring-slate-500/30';
        }
    };

    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'admin':
                return '管理者';
            case 'manager':
                return 'マネージャー';
            case 'user':
                return 'ユーザー';
            case 'viewer':
                return '閲覧者';
            case 'foreman1':
                return '職長1';
            case 'foreman2':
                return '職長2';
            case 'worker':
                return '職方';
            case 'partner':
                return '協力会社';
            case 'partner_member':
                return '協力会社メンバー';
            default:
                return role;
        }
    };

    return (
        <>
            {/* Mobile Backdrop */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-40 lg:hidden"
                    onClick={closeMobileMenu}
                />
            )}

            {/* Sidebar */}
            <aside
                data-dl-sidebar
                className={`
                    fixed left-0 top-0 h-dvh bg-slate-950
                    border-r border-slate-800/50 flex flex-col shadow-2xl z-50 transition-transform duration-300
                    w-48 pwa-sidebar-safe
                    ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
                    lg:translate-x-0
                `}
            >
                {/* Logo Area */}
                <div className="h-16 flex flex-col border-b border-slate-800/50">
                    <div className="flex-1 flex items-center px-4">
                    <button
                        onClick={handleReload}
                        disabled={isReloading}
                        className="flex items-center justify-center flex-1 active:scale-90 transition-transform duration-150"
                        aria-label="ホームに戻る（更新）"
                    >
                        <img
                            src={APP_LOGO}
                            alt={APP_NAME}
                            className={`h-6 w-auto ${isReloading ? 'animate-pulse opacity-50' : ''}`}
                        />
                    </button>
                    {/* Desktop Collapse Button */}
                    <button
                        onClick={toggleSidebarCollapse}
                        className="hidden lg:flex p-2 hover:bg-slate-800 rounded-lg transition-colors"
                        aria-label="サイドバーを折りたたむ"
                        title="サイドバーを折りたたむ"
                    >
                        <ChevronLeft className="w-5 h-5 text-slate-400" />
                    </button>
                    {/* Mobile Close Button */}
                    <button
                        onClick={closeMobileMenu}
                        className="lg:hidden p-2 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                    </div>
                    {isReloading && (
                        <div className="h-0.5 w-full bg-slate-800">
                            <div className="h-full bg-sky-400 animate-loading-bar" />
                        </div>
                    )}
                </div>

                {/* User Info */}
                {session?.user && (
                    <div className="px-3 py-4 border-b border-slate-800/50">
                        <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-800/40 rounded-xl">
                            <div className="w-10 h-10 bg-teal-600 rounded-full flex items-center justify-center ring-2 ring-teal-400/30 shadow-md">
                                <span className="text-sm font-bold text-white">
                                    {(session.user.name || session.user.username || '?').charAt(0).toUpperCase()}
                                </span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-200 truncate">
                                    {session.user.name || session.user.username}
                                </p>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${getRoleBadgeColor(session.user.role)}`}>
                                    {getRoleLabel(session.user.role)}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Navigation Menu */}
                <nav className="flex-1 overflow-y-auto py-6 px-3">
                    {navigationSections
                        .map(section => {
                            const role = session?.user?.role;
                            // requiredRoles で各アイテムを事前フィルタ（管理者専用メニューの非表示）
                            const allowedItems = section.items.filter(item =>
                                !item.requiredRoles || (role !== undefined && item.requiredRoles.includes(role))
                            );
                            const filteredSection = { ...section, items: allowedItems };

                            // workerロール: スケジュール + チャット + 材料管理(在庫/返却)
                            if (role === 'worker') {
                                if (filteredSection.title === '業務管理') {
                                    return { ...filteredSection, items: filteredSection.items.filter(item => item.page === 'schedule' || item.page === 'chat') };
                                }
                                if (filteredSection.title === '材料管理') {
                                    return { ...filteredSection, items: filteredSection.items.filter(item => item.page === 'inventory' || item.page === 'material-returns') };
                                }
                                return null;
                            }
                            // partner ロール: 業務管理(スケジュール+チャット) + 書類・経理(出来高表)
                            // partner_member ロール: 業務管理(スケジュール+チャット) のみ (出来高表は不可)
                            if (role === 'partner' || role === 'partner_member') {
                                if (section.title === '業務管理') {
                                    const partnerItems = section.items
                                        .filter(item => item.page === 'schedule' || item.page === 'chat');
                                    if (partnerItems.length === 0) return null;
                                    return { ...filteredSection, items: partnerItems };
                                }
                                if (section.title === '書類・経理' && role === 'partner') {
                                    const partnerItems = section.items
                                        .filter(item => item.page === 'partner-work-volume')
                                        .map(item => ({ ...item, name: '出来高表' }));
                                    if (partnerItems.length === 0) return null;
                                    return { ...filteredSection, items: partnerItems };
                                }
                                return null;
                            }
                            // 職長1/2: 業務管理 + 材料管理
                            if (role === 'foreman1' || role === 'foreman2') {
                                if (filteredSection.title === '業務管理') {
                                    return { ...filteredSection, items: filteredSection.items.filter(item => item.page === 'schedule' || item.page === 'project-masters' || item.page === 'reports' || item.page === 'attendance' || item.page === 'chat') };
                                }
                                if (filteredSection.title === '材料管理') return filteredSection;
                                return null;
                            }
                            // admin/manager 以外は図面（site-surveys）を非表示
                            if (role !== 'admin' && role !== 'manager') {
                                if (filteredSection.title === '書類・経理') {
                                    return {
                                        ...filteredSection,
                                        items: filteredSection.items.filter(item => item.page !== 'site-surveys'),
                                    };
                                }
                            }
                            return filteredSection;
                        })
                        .filter((section): section is NavSection => section !== null && section.items.length > 0)
                        .map((section, sectionIndex) => (
                            <div key={section.title} className={sectionIndex > 0 ? 'mt-8' : ''}>
                                <h3 className="px-3 mb-3 text-[13px] font-semibold text-slate-400 tracking-wider">
                                    {section.title}
                                </h3>
                                <ul className="space-y-1.5">
                                    {section.items.map((item) => {
                                        const isActive = activePage === item.page;

                                        return (
                                            <li key={item.name}>
                                                <button
                                                    onClick={() => handleNavigation(item.page)}
                                                    className={`
                                                    nav-item-animate w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium
                                                    ${isActive
                                                            ? 'bg-teal-700/90 text-white shadow-md shadow-teal-900/30 border-l-2 border-teal-400'
                                                            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border-l-2 border-transparent'
                                                        }
                                                `}
                                                >
                                                    <span className="flex-1 text-left">{item.name}</span>
                                                    {item.page === 'chat' && totalChatUnread > 0 && (
                                                        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-semibold">
                                                            {totalChatUnread > 99 ? '99+' : totalChatUnread}
                                                        </span>
                                                    )}
                                                    {isActive && <ChevronRight className="w-4 h-4 text-teal-200" />}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                </nav>

                {/* Utility Area */}
                <div className="flex-shrink-0 border-t border-slate-800/50 p-3 space-y-1">
                    <NotificationsInbox variant="row" />
                    <button className="nav-item-animate w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800/60 hover:text-slate-200">
                        <span>ヘルプ</span>
                    </button>
                    <button
                        onClick={handleLogout}
                        className="nav-item-animate w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-red-950/30 hover:text-slate-300"
                    >
                        <span>ログアウト</span>
                    </button>
                </div>
            </aside>
        </>
    );
}
