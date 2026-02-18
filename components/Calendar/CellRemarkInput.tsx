
import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCalendarStore } from '@/stores/calendarStore';
import { Pencil, X, Check } from 'lucide-react';

interface CellRemarkInputProps {
    foremanId: string;
    dateKey: string;
    isReadOnly?: boolean;
}

export default function CellRemarkInput({ foremanId, dateKey, isReadOnly = false }: CellRemarkInputProps) {
    const { setCellRemark } = useCalendarStore();
    // ストアから現在の値を取得
    const savedRemark = useCalendarStore(state => state.cellRemarks[`${foremanId}-${dateKey}`] || '');

    const [isEditing, setIsEditing] = useState(false);
    const [tempValue, setTempValue] = useState('');
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLDivElement>(null);

    const handleStartEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isReadOnly) return;

        // トリガー要素の位置を取得してPopoverの表示位置を計算
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            // 画面下端にはみ出さないように簡易的な調整（必要であれば）
            // 基本はトリガーの下または上に表示
            setPopoverPosition({
                top: rect.bottom + window.scrollY,
                left: rect.left + window.scrollX - 100 // 少し左にずらすなど調整
            });
        }
        setTempValue(savedRemark);
        setIsEditing(true);
    };

    const handleSave = () => {
        if (tempValue !== savedRemark) {
            setCellRemark(foremanId, dateKey, tempValue);
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    return (
        <>
            <div
                ref={triggerRef}
                className="mt-auto w-full"
                data-cell-remark
                onClick={(e) => e.stopPropagation()}
            >
                {savedRemark ? (
                    <>
                        <div
                            onClick={handleStartEdit}
                            className="w-full text-[10px] px-1 py-0.5 rounded cursor-pointer mt-1 bg-yellow-50 text-gray-700 border border-yellow-200 hover:bg-yellow-100 transition-colors whitespace-pre-wrap break-words"
                        >
                            {savedRemark}
                        </div>
                        {/* クリック領域確保用スペース */}
                        <div className="h-2 w-full" />
                    </>
                ) : !isReadOnly && (
                    <div className="flex justify-end">
                        <button
                            onClick={handleStartEdit}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
                            title="メモを追加"
                            aria-label="メモを追加"
                        >
                            <Pencil className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>

            {/* Portal Popover */}
            {isEditing && createPortal(
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/10"
                    onClick={handleSave} // 背景クリックで保存して閉じる
                >
                    <div
                        className="bg-white rounded-lg shadow-xl border border-gray-200 w-64 p-2 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-100"
                        style={{
                            position: 'fixed',
                            top: Math.min(popoverPosition.top, window.innerHeight - 150), // 画面下端対策
                            left: Math.min(Math.max(popoverPosition.left, 10), window.innerWidth - 270) // 画面端対策
                        }}
                        onClick={(e) => e.stopPropagation()} // 内部クリックは伝播させない
                    >
                        <div className="flex items-center justify-between border-b border-gray-100 pb-1 mb-1">
                            <span className="text-xs font-bold text-gray-700">メモ編集</span>
                            <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600">
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                        <textarea
                            autoFocus
                            value={tempValue}
                            onChange={(e) => setTempValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-full text-xs p-2 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[60px] resize-none"
                            placeholder="メモを入力..."
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={handleSave}
                                className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 flex items-center gap-1"
                            >
                                <Check className="w-3 h-3" /> 保存
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
