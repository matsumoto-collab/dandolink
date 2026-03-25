import React, { useState } from 'react';
import { WeekDay } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { useVacation } from '@/hooks/useVacation';
import VacationSelector from './VacationSelector';

interface RemarksRowProps {
    weekDays: WeekDay[];
    readOnly?: boolean;
}

export default function RemarksRow({ weekDays, readOnly = false }: RemarksRowProps) {
    const { vacations, getRemarks, setRemarks, addVacationEmployee, removeVacationEmployee } = useVacation();
    const [editingCell, setEditingCell] = useState<string | null>(null);
    const [tempValues, setTempValues] = useState<{ [key: string]: string }>({});

    const handleCellClick = (dateKey: string) => {
        setEditingCell(dateKey);
        setTempValues(prev => ({
            ...prev,
            [dateKey]: getRemarks(dateKey),
        }));
    };

    const handleBlur = (dateKey: string) => {
        const value = tempValues[dateKey] || '';
        setRemarks(dateKey, value);
        setEditingCell(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent, dateKey: string) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
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
        <div className="flex border-b-2 border-slate-300 bg-teal-50 shadow-sm h-auto min-h-[56px]">
            {/* 職長セル（固定） */}
            <div className="sticky left-0 z-30 bg-teal-50 border-r-2 border-slate-300 shadow-md">
                <div className="w-24 xl:w-32 h-full flex items-center justify-center py-2">
                    <span className="text-xs font-bold text-slate-900 tracking-wide">備考</span>
                </div>
            </div>

            {/* 日付セル */}
            {weekDays.map((day, index) => {
                const dateKey = formatDateKey(day.date);
                const isSaturday = day.dayOfWeek === 6;
                const isSunday = day.dayOfWeek === 0;
                const isEditing = editingCell === dateKey;
                const remarkText = isEditing ? (tempValues[dateKey] ?? '') : getRemarks(dateKey);
                const vacationEmployeeIds = vacations[dateKey]?.employeeIds || [];

                return (
                    <div
                        key={index}
                        className={`
                            flex-1 min-w-[110px] xl:min-w-[140px] border-r border-slate-200 p-1.5
                            transition-all duration-200
                            ${isSaturday ? 'bg-slate-50/40' : isSunday ? 'bg-slate-50/40' : 'bg-white'}
                        `}
                    >
                        <div className="flex flex-col gap-1 h-full">
                            {/* 休暇選択セクション */}
                            <VacationSelector
                                dateKey={dateKey}
                                selectedEmployeeIds={vacationEmployeeIds}
                                onAddEmployee={(empId) => addVacationEmployee(dateKey, empId)}
                                onRemoveEmployee={(empId) => removeVacationEmployee(dateKey, empId)}
                                readOnly={readOnly}
                            />

                            {/* フリーテキスト備考セクション */}
                            <div
                                className={`flex-1 ${!isEditing && !readOnly ? 'cursor-text hover:bg-slate-50/30 rounded' : ''}`}
                                onClick={() => !isEditing && !readOnly && handleCellClick(dateKey)}
                            >
                                {isEditing && !readOnly ? (
                                    <textarea
                                        autoFocus
                                        value={remarkText}
                                        onChange={(e) => setTempValues(prev => ({
                                            ...prev,
                                            [dateKey]: e.target.value,
                                        }))}
                                        onBlur={() => handleBlur(dateKey)}
                                        onKeyDown={(e) => handleKeyDown(e, dateKey)}
                                        className="w-full h-full min-h-[40px] p-1.5 text-xs resize-none border border-slate-400 rounded focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-transparent bg-white"
                                        placeholder="備考を入力..."
                                    />
                                ) : (
                                    <div className={`w-full h-full min-h-[40px] p-1.5 text-xs whitespace-pre-wrap break-words rounded ${remarkText ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-700'}`}>
                                        {remarkText || (
                                            readOnly ? null : <span className="text-slate-400 italic text-[10px]">クリックして入力</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
