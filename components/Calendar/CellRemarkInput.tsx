
import React, { useState, useEffect, useRef } from 'react';
import { useCalendarStore } from '@/stores/calendarStore';

interface CellRemarkInputProps {
    foremanId: string;
    dateKey: string;
    isReadOnly?: boolean;
}

export default function CellRemarkInput({ foremanId, dateKey, isReadOnly = false }: CellRemarkInputProps) {
    const { setCellRemark } = useCalendarStore();
    // ストアから現在の値を取得
    const savedRemark = useCalendarStore(state => state.cellRemarks[`${foremanId}-${dateKey}`] || '');

    const [value, setValue] = useState(savedRemark);
    const [isEditing, setIsEditing] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // ストアの値が変更されたらローカルstateも更新 (編集中でなければ)
    useEffect(() => {
        if (!isEditing) {
            setValue(savedRemark);
        }
    }, [savedRemark, isEditing]);

    const handleBlur = () => {
        setIsEditing(false);
        if (value !== savedRemark) {
            setCellRemark(foremanId, dateKey, value);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            setIsEditing(false); // Blur will handle save
            if (value !== savedRemark) {
                setCellRemark(foremanId, dateKey, value);
            }
        } else if (e.key === 'Escape') {
            setValue(savedRemark); // キャンセルして直前の保存値に戻す
            setIsEditing(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(e.target.value);
    };

    if (isReadOnly && !value) return null;

    return (
        <div
            className="mt-auto px-1 pb-1 w-full"
            data-cell-remark // DroppableCellのクリック伝播防止用
            onClick={(e) => {
                e.stopPropagation();
                if (!isEditing && !isReadOnly) {
                    setIsEditing(true);
                }
            }}
        >
            {isEditing ? (
                <textarea
                    ref={textareaRef}
                    autoFocus
                    value={value}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    className="w-full p-1 text-xs resize-none border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white shadow-sm"
                    placeholder="メモ..."
                    style={{ minHeight: '40px' }}
                />
            ) : (
                <div
                    className={`
                        w-full text-xs whitespace-pre-wrap break-words rounded px-1
                        ${value ? 'text-gray-700 hover:bg-gray-100/50 cursor-text' : 'text-gray-400 h-[20px]'}
                    `}
                >
                    {value || (isReadOnly ? null : <span className="opacity-50 text-[10px]">メモ...</span>)}
                </div>
            )}
        </div>
    );
}
