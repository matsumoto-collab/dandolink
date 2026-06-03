'use client';

import toast from 'react-hot-toast';
import { Undo2 } from 'lucide-react';

interface ShowUndoToastOptions {
    /** 表示するメッセージ（例: 「佐藤様邸 を移動しました」） */
    message: string;
    /** 「元に戻す」を押したときの処理 */
    onUndo: () => void;
    /** ボタンの文言（既定: 元に戻す） */
    undoLabel?: string;
    /** 表示時間（ms, 既定: 8000）。この時間を過ぎると元に戻せなくなる */
    duration?: number;
}

/**
 * 操作直後に「元に戻す」ボタン付きのトーストを表示する（移動・削除のUndo用）。
 * 既存の確認トースト（WeeklyCalendar の人数調整）と同じ bottom-center / slate-800 の見た目に揃える。
 * onUndo は一度だけ実行され、押下時点でトーストを閉じる（連打での二重実行を防ぐ）。
 */
export function showUndoToast({ message, onUndo, undoLabel = '元に戻す', duration = 8000 }: ShowUndoToastOptions): void {
    let used = false;
    toast.custom(
        (t) => (
            <div
                className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-slate-800 text-white ${t.visible ? 'animate-enter' : 'animate-leave'}`}
            >
                <span className="text-sm whitespace-nowrap">{message}</span>
                <button
                    onClick={() => {
                        if (used) return;
                        used = true;
                        toast.dismiss(t.id);
                        onUndo();
                    }}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg bg-white text-slate-800 hover:bg-slate-100 active:bg-slate-200 whitespace-nowrap flex-shrink-0"
                >
                    <Undo2 className="w-3.5 h-3.5" />
                    {undoLabel}
                </button>
            </div>
        ),
        { duration, position: 'bottom-center' }
    );
}
