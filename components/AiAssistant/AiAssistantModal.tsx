'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import AiAssistantView from './AiAssistantView';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface AiAssistantModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * スケジュールAI照会のモーダル。
 * スケジュールツールバーの「AI照会」ボタンから開く（kei要望: カレンダー内から
 * ワンタップで聞ける動線）。一度開いたら閉じても hidden で保持し、
 * うっかり閉じても会話（続き質問の文脈）が消えないようにする。
 */
export default function AiAssistantModal({ isOpen, onClose }: AiAssistantModalProps) {
    const modalRef = useModalKeyboard(isOpen, onClose);
    // 初回オープンまでは何もレンダリングしない（チャンク読込と無駄なマウントを避ける）
    const [hasOpened, setHasOpened] = useState(false);
    useEffect(() => {
        if (isOpen) setHasOpened(true);
    }, [isOpen]);
    if (!hasOpened) return null;

    return (
        // h-[100dvh]: iOS Safari では inset-0 がツールバー込みの高さになり下端の入力欄が
        // 画面外に隠れるため、動的ビューポート高で実際に見えている高さに合わせる
        <div className={`fixed inset-x-0 top-0 h-[100dvh] lg:left-48 z-[70] flex flex-col items-center justify-start pt-[4.5rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50 ${isOpen ? '' : 'hidden'}`}>
            {/* オーバーレイ（デスクトップのみ） */}
            <div className="absolute inset-0 bg-black/50 hidden lg:block" onClick={onClose} />

            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full flex-1 min-h-0 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-2xl lg:mx-4 lg:h-[75vh]"
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-teal-600" />
                        AI照会（空き・仮予定・浮き）
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* チャット本体 */}
                <div className="flex-1 min-h-0 bg-slate-50/50">
                    <AiAssistantView />
                </div>
            </div>
        </div>
    );
}
