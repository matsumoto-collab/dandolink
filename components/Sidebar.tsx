'use client';

import React, { useState } from 'react';
import { useNavigation, PageType } from '@/contexts/NavigationContext';
import { useSession, signOut } from 'next-auth/react';
import {
    ChevronRight,
    X,
} from 'lucide-react';

interface NavItem {
    name: string;
    page: 'schedule' | 'project-masters' | 'reports' | 'profit-dashboard' | 'estimates' | 'invoices' | 'orders' | 'materials' | 'partners' | 'customers' | 'company' | 'settings';
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
            { name: '案件一覧', page: 'project-masters' },
            { name: '日報一覧', page: 'reports' },
            { name: '材料出庫伝票', page: 'materials' },
        ],
    },
    {
        title: '書類・経理',
        items: [
            { name: '見積書', page: 'estimates' },
            { name: '請求書', page: 'invoices' },
            { name: '発注書', page: 'orders' },
            { name: '利益ダッシュボード', page: 'profit-dashboard' },
        ],
    },
    {
        title: 'マスター・設定',
        items: [
            { name: '協力会社', page: 'partners' },
            { name: '顧客管理', page: 'customers' },
            { name: '自社情報', page: 'company' },
            { name: '設定', page: 'settings' },
        ],
    },
];

export default function Sidebar() {
    const { activePage, setActivePage, isMobileMenuOpen, closeMobileMenu } = useNavigation();
    const { data: session } = useSession();
    const [isReloading, setIsReloading] = useState(false);

    const handleReload = () => {
        setIsReloading(true);
        window.location.reload();
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
                    fixed left-0 top-0 h-dvh bg-gradient-to-b from-slate-950 to-slate-900
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
                            src="/dandlink-logo.svg"
                            alt="DandLink"
                            className={`h-6 w-auto ${isReloading ? 'animate-pulse opacity-50' : ''}`}
                        />
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
                            <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-700 rounded-full flex items-center justify-center ring-2 ring-teal-400/30 shadow-md">
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
                            // workerまたはpartnerロールの場合、スケジュール管理のみ表示
                            if (session?.user?.role === 'worker' || session?.user?.role === 'partner') {
                                if (section.title !== '業務管理') return null;
                                const filteredItems = section.items.filter(item => item.page === 'schedule');
                                if (filteredItems.length === 0) return null;
                                return { ...section, items: filteredItems };
                            }
                            // 職長1: 業務管理のみ（スケジュール・案件一覧・日報一覧）
                            if (session?.user?.role === 'foreman1') {
                                if (section.title !== '業務管理') return null;
                                const filteredItems = section.items.filter(item => item.page === 'schedule' || item.page === 'project-masters' || item.page === 'reports');
                                if (filteredItems.length === 0) return null;
                                return { ...section, items: filteredItems };
                            }
                            // 職長2: 業務管理のみ（スケジュール・案件一覧・日報一覧）
                            if (session?.user?.role === 'foreman2') {
                                if (section.title !== '業務管理') return null;
                                const filteredItems = section.items.filter(item => item.page === 'schedule' || item.page === 'project-masters' || item.page === 'reports');
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
