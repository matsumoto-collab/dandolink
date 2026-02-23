'use client';

import React from 'react';
import { useNavigation, PageType } from '@/contexts/NavigationContext';
import { useSession, signOut } from 'next-auth/react';
import {
    Home,
    Briefcase,
    FileText,
    FileSpreadsheet,
    Receipt,
    ShoppingCart,
    Users,
    Building,
    Settings,
    HelpCircle,
    LogOut,
    ChevronRight,
    User as UserIcon,
    X,
    BarChart3,
} from 'lucide-react';

interface NavItem {
    name: string;
    icon: React.ElementType;
    page: 'schedule' | 'project-masters' | 'reports' | 'profit-dashboard' | 'estimates' | 'invoices' | 'orders' | 'partners' | 'customers' | 'company' | 'settings';
}

interface NavSection {
    title: string;
    items: NavItem[];
}

const navigationSections: NavSection[] = [
    {
        title: '業務管理',
        items: [
            { name: 'スケジュール管理', icon: Home, page: 'schedule' },
            { name: '案件一覧', icon: Briefcase, page: 'project-masters' },
            { name: '日報一覧', icon: FileText, page: 'reports' },
        ],
    },
    {
        title: '書類・経理',
        items: [
            { name: '見積書', icon: FileSpreadsheet, page: 'estimates' },
            { name: '請求書', icon: Receipt, page: 'invoices' },
            { name: '発注書', icon: ShoppingCart, page: 'orders' },
            { name: '利益ダッシュボード', icon: BarChart3, page: 'profit-dashboard' },
        ],
    },
    {
        title: 'マスター・設定',
        items: [
            { name: '協力会社', icon: Users, page: 'partners' },
            { name: '顧客管理', icon: Building, page: 'customers' },
            { name: '自社情報', icon: Building, page: 'company' },
            { name: '設定', icon: Settings, page: 'settings' },
        ],
    },
];

export default function Sidebar() {
    const { activePage, setActivePage, isMobileMenuOpen, closeMobileMenu } = useNavigation();
    const { data: session } = useSession();

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
                return 'bg-gray-500/20 text-gray-300 ring-gray-500/30';
            default:
                return 'bg-gray-500/20 text-gray-300 ring-gray-500/30';
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
            default:
                return role;
        }
    };

    return (
        <>
            {/* Mobile Backdrop */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={closeMobileMenu}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`
                    fixed left-0 top-0 h-dvh bg-slate-900
                    border-r border-slate-800 flex flex-col shadow-lg z-50 transition-transform duration-300
                    w-64 pwa-sidebar-safe
                    ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
                    lg:translate-x-0
                `}
            >
                {/* Logo Area */}
                <div className="h-16 flex items-center px-4 border-b border-slate-800">
                    <button
                        onClick={() => window.location.reload()}
                        className="flex items-center justify-center flex-1 hover:opacity-80 active:opacity-60 transition-opacity"
                        aria-label="ホームに戻る（更新）"
                    >
                        <img src="/dandlink-logo.svg" alt="DandLink" className="h-6 w-auto" />
                    </button>
                    {/* Mobile Close Button */}
                    <button
                        onClick={closeMobileMenu}
                        className="lg:hidden p-2 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                </div>

                {/* User Info */}
                {session?.user && (
                    <div className="px-3 py-4 border-b border-slate-800">
                        <div className="flex items-center gap-3 px-3 py-2 bg-slate-800/60 rounded-lg">
                            <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center">
                                <UserIcon className="w-5 h-5 text-slate-300" />
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
                            // workerまたはpartnerロールの場合、スケジュール管理のみ表示
                            if (session?.user?.role === 'worker' || session?.user?.role === 'partner') {
                                if (section.title !== '業務管理') return null;
                                const filteredItems = section.items.filter(item => item.page === 'schedule');
                                if (filteredItems.length === 0) return null;
                                return { ...section, items: filteredItems };
                            }
                            return section;
                        })
                        .filter((section): section is NavSection => section !== null)
                        .map((section, sectionIndex) => (
                            <div key={section.title} className={sectionIndex > 0 ? 'mt-8' : ''}>
                                <h3 className="px-3 mb-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                                    {section.title}
                                </h3>
                                <ul className="space-y-1.5">
                                    {section.items.map((item) => {
                                        const Icon = item.icon;
                                        const isActive = activePage === item.page;

                                        return (
                                            <li key={item.name}>
                                                <button
                                                    onClick={() => handleNavigation(item.page)}
                                                    className={`
                                                    w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150
                                                    ${isActive
                                                            ? 'bg-slate-700/80 text-white'
                                                            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                                                        }
                                                `}
                                                >
                                                    <Icon className={`w-5 h-5 ${isActive ? 'text-slate-200' : 'text-slate-500'}`} />
                                                    <span className="flex-1 text-left">{item.name}</span>
                                                    {isActive && <ChevronRight className="w-4 h-4 text-slate-300" />}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                </nav>

                {/* Utility Area */}
                <div className="flex-shrink-0 border-t border-slate-800 p-3 space-y-1">
                    <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors duration-150">
                        <HelpCircle className="w-5 h-5 text-slate-500" />
                        <span>ヘルプ</span>
                    </button>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-red-950/30 hover:text-slate-300 transition-colors duration-150"
                    >
                        <LogOut className="w-5 h-5" />
                        <span>ログアウト</span>
                    </button>
                </div>
            </aside>
        </>
    );
}
