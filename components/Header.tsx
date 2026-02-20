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
                <h1 className="text-lg font-semibold text-slate-100">
                    DandoLink
                </h1>
            </div>

            {/* Spacer for symmetry */}
            <div className="w-10" />
        </header>
    );
}
