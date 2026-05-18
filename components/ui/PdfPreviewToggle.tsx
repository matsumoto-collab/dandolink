'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PdfPreviewToggleProps {
    /** プレビューが表示中か */
    visible: boolean;
    /** トグル時に呼ばれる */
    onToggle: () => void;
    /** 追加クラス（配置調整用） */
    className?: string;
}

/**
 * PDFライブプレビューの表示/非表示を切り替えるトグルボタン。
 * 見積書・請求書など左右2カラム画面の lg+ ツールバーで共通利用する。
 */
export function PdfPreviewToggle({ visible, onToggle, className = '' }: PdfPreviewToggleProps) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={visible}
            title={visible ? 'プレビューを非表示' : 'プレビューを表示'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors ${className}`}
        >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {visible ? 'プレビューを非表示' : 'プレビューを表示'}
        </button>
    );
}
