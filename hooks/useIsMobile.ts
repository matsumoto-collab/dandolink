'use client';

import { useState, useEffect } from 'react';

/**
 * モバイル判定フック
 * @param breakpoint ブレークポイント（デフォルト: 1024px = lg）
 * @returns モバイルかどうか
 */
export function useIsMobile(breakpoint: number = 1024): boolean {
    // SSR時はfalse、クライアント側で初期値を判定
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.innerWidth < breakpoint;
    });

    useEffect(() => {
        // クライアント側で初期チェック（SSRからの復帰時に必要）
        const checkMobile = () => {
            setIsMobile(window.innerWidth < breakpoint);
        };

        // 初回チェック（マウント時に必ず実行）
        checkMobile();

        // リサイズイベントを監視
        window.addEventListener('resize', checkMobile);

        return () => {
            window.removeEventListener('resize', checkMobile);
        };
    }, [breakpoint]);

    return isMobile;
}

/**
 * タブレット判定フック
 * @returns タブレット以下かどうか（768px未満）
 */
export function useIsTablet(): boolean {
    return useIsMobile(768);
}

/**
 * スマートフォン判定フック
 * @returns スマートフォンかどうか（640px未満）
 */
export function useIsSmartphone(): boolean {
    return useIsMobile(640);
}
