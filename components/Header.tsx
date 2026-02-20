'use client';

import React from 'react';
import { useNavigation } from '@/contexts/NavigationContext';
import { Menu } from 'lucide-react';

export default function Header() {
    const { toggleMobileMenu } = useNavigation();

    return (
        <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-slate-900 border-b border-slate-800 flex items-center px-4 z-30 shadow-md">
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
                    onClick={() => window.location.reload()}
                    className="text-lg font-semibold text-slate-100 active:opacity-70 transition-opacity"
                    aria-label="ホームに戻る（更新）"
                >
                    DandoLink
                </button>
            </div>

            {/* Spacer for symmetry */}
            <div className="w-10" />
        </header>
    );
}
