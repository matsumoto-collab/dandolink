'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

export type PageType =
    | 'schedule'         // スケジュール管理
    | 'project-masters'  // 案件マスター管理
    | 'reports'          // 日報入力
    | 'profit-dashboard' // 利益ダッシュボード
    | 'estimates'        // 見積書
    | 'invoices'         // 請求書
    | 'orders'           // 発注書
    | 'partners'         // 協力会社
    | 'customers'        // 顧客管理
    | 'company'          // 自社情報
    | 'settings';        // 設定

interface NavigationContextType {
    activePage: PageType;
    setActivePage: (page: PageType) => void;
    isMobileMenuOpen: boolean;
    toggleMobileMenu: () => void;
    closeMobileMenu: () => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export function NavigationProvider({ children }: { children: ReactNode }) {
    const [activePage, setActivePage] = useState<PageType>('schedule');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const toggleMobileMenu = () => setIsMobileMenuOpen(prev => !prev);
    const closeMobileMenu = () => setIsMobileMenuOpen(false);

    return (
        <NavigationContext.Provider value={{
            activePage,
            setActivePage,
            isMobileMenuOpen,
            toggleMobileMenu,
            closeMobileMenu,
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
