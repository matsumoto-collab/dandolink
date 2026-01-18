'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingProps {
    /** ローディングのサイズ */
    size?: 'sm' | 'md' | 'lg';
    /** テキストを表示するか */
    text?: string;
    /** フルスクリーン表示 */
    fullScreen?: boolean;
    /** オーバーレイ表示（モーダル用） */
    overlay?: boolean;
    /** カスタムクラス */
    className?: string;
}

const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
};

/**
 * 統一されたローディングコンポーネント
 *
 * @example
 * // 基本的な使用
 * <Loading />
 *
 * // テキスト付き
 * <Loading text="読み込み中..." />
 *
 * // フルスクリーン
 * <Loading fullScreen text="データを取得しています..." />
 *
 * // オーバーレイ（モーダル用）
 * <Loading overlay />
 */
export default function Loading({
    size = 'md',
    text,
    fullScreen = false,
    overlay = false,
    className = ''
}: LoadingProps) {
    const spinner = (
        <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
            <Loader2 className={`animate-spin text-slate-600 ${sizeClasses[size]}`} />
            {text && (
                <p className="text-sm text-slate-600 animate-pulse">{text}</p>
            )}
        </div>
    );

    // オーバーレイ表示（モーダル遅延読み込み用）
    if (overlay) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
                <div className="bg-white rounded-lg p-6 shadow-xl">
                    <Loader2 className={`animate-spin text-slate-600 ${sizeClasses[size]}`} />
                </div>
            </div>
        );
    }

    // フルスクリーン表示
    if (fullScreen) {
        return (
            <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-white z-40">
                {spinner}
            </div>
        );
    }

    // インライン表示
    return spinner;
}

/**
 * ページ全体のローディング表示
 */
export function PageLoading({ text = '読み込み中...' }: { text?: string }) {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <Loading size="lg" text={text} />
        </div>
    );
}

/**
 * テーブル行のスケルトンローディング
 */
export function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
    return (
        <tr className="animate-pulse">
            {Array.from({ length: columns }).map((_, i) => (
                <td key={i} className="px-6 py-4">
                    <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                </td>
            ))}
        </tr>
    );
}

/**
 * カードのスケルトンローディング
 */
export function CardSkeleton() {
    return (
        <div className="bg-white border border-gray-200 rounded-lg p-5 animate-pulse">
            <div className="h-5 bg-slate-200 rounded w-3/4 mb-3"></div>
            <div className="space-y-2">
                <div className="h-3 bg-slate-200 rounded w-full"></div>
                <div className="h-3 bg-slate-200 rounded w-5/6"></div>
                <div className="h-3 bg-slate-200 rounded w-4/6"></div>
            </div>
        </div>
    );
}

/**
 * ボタンのローディング状態
 */
export function ButtonLoading({ size = 'sm' }: { size?: 'sm' | 'md' }) {
    return <Loader2 className={`animate-spin ${size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'}`} />;
}
