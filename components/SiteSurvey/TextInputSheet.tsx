'use client';

import React, { useEffect, useRef, useState } from 'react';
import BottomSheet from '@/components/ui/BottomSheet';

interface TextInputSheetProps {
    open: boolean;
    mode: 'new' | 'edit';
    initialText: string;
    onCancel: () => void;
    onConfirm: (text: string) => void;
    onDelete?: () => void;
}

export default function TextInputSheet({
    open,
    mode,
    initialText,
    onCancel,
    onConfirm,
    onDelete,
}: TextInputSheetProps) {
    const [text, setText] = useState<string>('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!open) return;
        setText(initialText);
        const t = setTimeout(() => textareaRef.current?.focus(), 200);
        return () => clearTimeout(t);
    }, [open, initialText]);

    const isValid = text.trim().length > 0;

    const handleDelete = () => {
        if (!onDelete) return;
        if (!confirm('このテキストを削除しますか？')) return;
        onDelete();
    };

    return (
        <BottomSheet open={open} onClose={onCancel}>
            <div className="mb-2">
                <div className="text-sm font-semibold text-slate-700">
                    {mode === 'edit' ? 'テキストを編集' : 'テキストを追加'}
                </div>
            </div>

            <div className="mb-3">
                <textarea
                    ref={textareaRef}
                    rows={4}
                    value={text}
                    placeholder="現場メモ / 注意事項 / 寸法など"
                    onChange={(e) => setText(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-amber-500 shadow-sm text-sm resize-none"
                />
            </div>

            <div className="flex gap-2">
                {mode === 'edit' && onDelete && (
                    <button
                        type="button"
                        onClick={handleDelete}
                        className="px-4 py-2 rounded-xl border border-red-200 text-red-600 font-medium hover:bg-red-50"
                    >
                        削除
                    </button>
                )}
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 py-2 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50"
                >
                    キャンセル
                </button>
                <button
                    type="button"
                    onClick={() => isValid && onConfirm(text)}
                    disabled={!isValid}
                    className="flex-1 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-medium shadow-sm disabled:opacity-50"
                >
                    保存
                </button>
            </div>
        </BottomSheet>
    );
}
