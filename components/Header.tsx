'use client';

import React, { useState } from 'react';
import { useNavigation } from '@/contexts/NavigationContext';
import { Menu } from 'lucide-react';
import NotificationsInbox from '@/components/Notifications/NotificationsInbox';
import { APP_NAME, APP_LOGO } from '@/lib/branding';

export default function Header() {
    const { toggleMobileMenu, setActivePage } = useNavigation();
    const [isReloading, setIsReloading] = useState(false);

    // ロゴタップ: 全リロード（白→濃紺→明の暗転の原因）をやめ、SPA 内でホーム（工程管理）へ遷移。
    // 業務データは Realtime/ポーリング/broadcast で自動更新されるため再取得は不要。
    // ローディングバーはタップのフィードバックとして一瞬だけ見せる。
    const handleReload = () => {
        setIsReloading(true);
        setActivePage('schedule');
        setTimeout(() => setIsReloading(false), 400);
    };

    return (
        <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-gradient-to-r from-slate-950 to-slate-900 border-b border-slate-800/50 flex flex-col z-30 shadow-xl pwa-header-safe pwa-status-bar-bg">
            <div className="flex-1 flex items-center px-4">
                {/* Hamburger Menu Button */}
                <button
                    onClick={toggleMobileMenu}
                    className="p-2 hover:bg-slate-800/60 rounded-lg transition-colors duration-150"
                    aria-label="メニューを開く"
                >
                    <Menu className="w-6 h-6 text-slate-300" />
                </button>

                {/* Logo/Title */}
                <div className="flex-1 flex items-center justify-center">
                    <button
                        onClick={handleReload}
                        disabled={isReloading}
                        className="active:scale-90 transition-transform duration-150"
                        aria-label="ホームに戻る（更新）"
                    >
                        <img
                            src={APP_LOGO}
                            alt={APP_NAME}
                            className={`h-6 w-auto ${isReloading ? 'animate-pulse opacity-50' : ''}`}
                        />
                    </button>
                </div>

                {/* 通知ベル */}
                <NotificationsInbox variant="icon" />
            </div>

            {/* Loading bar */}
            {isReloading && (
                <div className="h-0.5 w-full bg-slate-800">
                    <div className="h-full bg-sky-400 animate-loading-bar" />
                </div>
            )}
        </header>
    );
}
