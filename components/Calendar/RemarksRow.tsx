import React, { useState, useEffect } from 'react';
import { WeekDay } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { useRemarks } from '@/contexts/RemarksContext';

interface RemarksRowProps {
    weekDays: WeekDay[];
}

export default function RemarksRow({ weekDays }: RemarksRowProps) {
    const { getRemark, setRemark } = useRemarks();
    const [editingCell, setEditingCell] = useState<string | null>(null);
    const [tempValues, setTempValues] = useState<{ [key: string]: string }>({});

    const handleCellClick = (dateKey: string) => {
        setEditingCell(dateKey);
        setTempValues(prev => ({
            ...prev,
            [dateKey]: getRemark(dateKey),
        }));
    };

    const handleBlur = (dateKey: string) => {
        const value = tempValues[dateKey] || '';
        setRemark(dateKey, value);
        setEditingCell(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent, dateKey: string) => {
        if (e.key === 'Enter') {
            handleBlur(dateKey);
        } else if (e.key === 'Escape') {
            setEditingCell(null);
            setTempValues(prev => {
                const newValues = { ...prev };
                delete newValues[dateKey];
                return newValues;
            });
        }
    };

    return (
        <div className="flex border-b-2 border-slate-300 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-sm sticky top-[89px] z-20 h-16">
            {/* 職長セル（固定） */}
            <div className="sticky left-0 z-30 bg-gradient-to-r from-blue-50 to-indigo-50 border-r-2 border-slate-300 shadow-md">
                <div className="w-32 h-full flex items-center justify-center">
                    <span className="text-sm font-bold text-indigo-900 tracking-wide">備考</span>
                </div>
            </div>

            {/* 日付セル */}
            {weekDays.map((day, index) => {
                const dateKey = formatDateKey(day.date);
                const isSaturday = day.dayOfWeek === 6;
                const isSunday = day.dayOfWeek === 0;
                const isEditing = editingCell === dateKey;
                const remarkText = isEditing ? (tempValues[dateKey] ?? '') : getRemark(dateKey);

                return (
                    <div
                        key={index}
                        className={`
                            flex-1 min-w-[140px] h-full border-r border-gray-200 p-1.5
                            transition-all duration-200
                            ${isSaturday ? 'bg-blue-50/40' : isSunday ? 'bg-red-50/40' : 'bg-white'}
                            ${!isEditing ? 'cursor-text hover:bg-indigo-50/30 hover:shadow-sm' : ''}
                        `}
                        onClick={() => !isEditing && handleCellClick(dateKey)}
                    >
                        {isEditing ? (
                            <textarea
                                autoFocus
                                value={remarkText}
                                onChange={(e) => setTempValues(prev => ({
                                    ...prev,
                                    [dateKey]: e.target.value,
                                }))}
                                onBlur={() => handleBlur(dateKey)}
                                onKeyDown={(e) => handleKeyDown(e, dateKey)}
                                className="w-full h-full p-2 text-xs resize-none border-2 border-indigo-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-md bg-white"
                                placeholder="備考を入力..."
                            />
                        ) : (
                            <div className="w-full h-full p-2 text-xs whitespace-pre-wrap break-words text-gray-700">
                                {remarkText || (
                                    <span className="text-gray-400 italic">クリックして入力</span>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
