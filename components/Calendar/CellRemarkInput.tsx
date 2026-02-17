
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

    const handleFocus = () => {
        if (isReadOnly) return;
        setIsEditing(true);
    };

    const handleBlur = () => {
        setIsEditing(false);
        if (value !== savedRemark) {
            setCellRemark(foremanId, dateKey, value);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            textareaRef.current?.blur();
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
            onClick={(e) => e.stopPropagation()}
        >
            <textarea
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                readOnly={isReadOnly}
                placeholder={isReadOnly ? '' : 'メモ...'}
                rows={1}
                className={`
                    w-full text-[10px] leading-tight bg-transparent resize-none overflow-hidden
                    placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded
                    ${isEditing ? 'bg-white shadow-sm min-h-[40px] z-10 relative' : 'hover:bg-gray-100/50 min-h-[20px] truncate'}
                    ${value ? 'text-gray-700' : 'text-gray-400'}
                `}
                style={{
                    height: isEditing ? 'auto' : '20px',
                    minHeight: isEditing ? '40px' : '20px'
                }}
            />
        </div>
    );
}
