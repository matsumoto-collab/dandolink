'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type PageType =
    | 'schedule'         // スケジュール管理
    | 'my-schedule'      // マイ工程管理
    | 'project-masters'  // 案件マスター管理
    | 'reports'          // 日報入力
    | 'profit-dashboard' // 利益ダッシュボード
    | 'estimates'        // 見積書
    | 'invoices'         // 請求書
    | 'orders'           // 発注書
    | 'partners'         // 協力会社
    | 'customers'        // 顧客管理
    | 'company'          // 自社情報
    | 'materials'        // 材料出庫伝票
    | 'inventory'        // 在庫管理
    | 'loading-list'     // 積込リスト
    | 'attendance'       // 出勤簿
    | 'settings';        // 設定

interface NavigationContextType {
    activePage: PageType;
    setActivePage: (page: PageType) => void;
    isMobileMenuOpen: boolean;
    toggleMobileMenu: () => void;
    closeMobileMenu: () => void;
    isSidebarCollapsed: boolean;
    toggleSidebarCollapse: () => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

const SIDEBAR_COLLAPSED_KEY = 'dandolink:sidebarCollapsed';

export function NavigationProvider({ children }: { children: ReactNode }) {
    const [activePage, setActivePage] = useState<PageType>('schedule');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    const toggleMobileMenu = () => setIsMobileMenuOpen(prev => !prev);
    const closeMobileMenu = () => setIsMobileMenuOpen(false);
    const toggleSidebarCollapse = () => setIsSidebarCollapsed(prev => !prev);

    // localStorageから初期値を復元
    useEffect(() => {
        try {
            const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
            if (stored === 'true') setIsSidebarCollapsed(true);
        } catch {
            // localStorage 不可環境は無視
        }
    }, []);

    // 永続化 + body data attr 同期（CSSフックとして利用）
    useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isSidebarCollapsed));
        } catch {
            // ignore
        }
        if (typeof document !== 'undefined') {
            document.body.dataset.sidebarCollapsed = String(isSidebarCollapsed);
        }
    }, [isSidebarCollapsed]);

    return (
        <NavigationContext.Provider value={{
            activePage,
            setActivePage,
            isMobileMenuOpen,
            toggleMobileMenu,
            closeMobileMenu,
            isSidebarCollapsed,
            toggleSidebarCollapse,
        }}>
            {children}
        </NavigationContext.Provider>
    );
}

export function useNavigation() {
    const context = useContext(NavigationContext);
    if (context === undefined) {
        throw new Error('useNavigation must be used within a NavigationProvider');
    }
    return context;
}
