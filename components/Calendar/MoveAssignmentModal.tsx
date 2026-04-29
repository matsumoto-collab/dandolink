'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { CalendarEvent, Employee } from '@/types/calendar';
import { X, MoveRight, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { formatDateKey } from '@/utils/employeeUtils';
import { addDays, formatDate, getDayOfWeekString, isToday } from '@/utils/dateUtils';
import { logger } from '@/lib/logger';

interface MoveAssignmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    event: CalendarEvent | null;
    employees: Employee[];
    onMove: (eventId: string, employeeId: string, date: Date) => Promise<void>;
}

const WEEKS_TO_SHOW = 2;

export default function MoveAssignmentModal({
    isOpen,
    onClose,
    event,
    employees,
    onMove,
}: MoveAssignmentModalProps) {
    const [weekStart, setWeekStart] = useState<Date>(() => new Date());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const modalRef = useModalKeyboard(isOpen, onClose);

    useEffect(() => {
        if (isOpen && event) {
            const base = event.startDate ? new Date(event.startDate) : new Date();
            base.setHours(0, 0, 0, 0);
            setWeekStart(base);
        }
    }, [isOpen, event]);

    const days = useMemo(() => {
        const arr: Date[] = [];
        for (let i = 0; i < 7 * WEEKS_TO_SHOW; i++) {
            arr.push(addDays(weekStart, i));
        }
        return arr;
    }, [weekStart]);

    const currentEmployeeId = event?.assignedEmployeeId ?? '';
    const currentDateKey = event?.startDate ? formatDateKey(new Date(event.startDate)) : '';

    const handleCellClick = async (employeeId: string, date: Date) => {
        if (!event || isSubmitting) return;
        if (employeeId === currentEmployeeId && formatDateKey(date) === currentDateKey) {
            toast('現在と同じ位置です', { icon: 'ℹ️' });
            return;
        }
        setIsSubmitting(true);
        try {
            await onMove(event.id, employeeId, date);
            onClose();
        } catch (error) {
            logger.error('Failed to move assignment:', error);
            toast.error('移動に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen || !event) return null;

    const rangeLabel = `${formatDate(days[0], 'short')}〜${formatDate(days[days.length - 1], 'short')}`;

    return (
        <div className="fixed inset-0 z-50 flex flex-col lg:items-center lg:justify-center lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:rounded-xl lg:shadow-lg lg:max-w-5xl lg:max-h-[85vh]"
            >
                <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 pwa-modal-safe">
                    <div className="flex items-center gap-2">
                        <MoveRight className="w-5 h-5 text-slate-600" />
                        <div>
                            <h2 className="text-lg font-semibold text-slate-800">案件を移動</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                「{event.title}」 を移動先のセルをクリックして指定
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50">
                    <button
                        onClick={() => setWeekStart(addDays(weekStart, -7))}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg hover:bg-slate-200 text-slate-700 transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        前の週
                    </button>
                    <button
                        onClick={() => {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            setWeekStart(today);
                        }}
                        className="font-bold text-sm text-slate-800 px-3 py-1 rounded-lg hover:bg-slate-200 transition-colors"
                    >
                        {rangeLabel}
                    </button>
                    <button
                        onClick={() => setWeekStart(addDays(weekStart, 7))}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg hover:bg-slate-200 text-slate-700 transition-colors"
                    >
                        次の週
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    <div className="min-w-[900px]">
                        <div className="flex border-b-2 border-slate-300 bg-slate-100 sticky top-0 z-10">
                            <div className="sticky left-0 z-20 bg-slate-100 border-r-2 border-slate-300 w-32 h-9 flex items-center justify-center">
                                <span className="text-xs font-bold text-slate-700 tracking-wide">職長</span>
                            </div>
                            {days.map((day, idx) => {
                                const isSat = day.getDay() === 6;
                                const isSun = day.getDay() === 0;
                                const today = isToday(day);
                                return (
                                    <div
                                        key={idx}
                                        className={`flex-1 min-w-[80px] border-r border-slate-200 h-9 flex items-center justify-center ${
                                            today ? 'bg-slate-700' : isSat ? 'bg-blue-50' : isSun ? 'bg-rose-50' : ''
                                        }`}
                                    >
                                        <span
                                            className={`text-[11px] font-bold ${
                                                today ? 'text-white' : isSat ? 'text-slate-700' : isSun ? 'text-slate-600' : 'text-slate-700'
                                            }`}
                                        >
                                            {formatDate(day, 'short')}({getDayOfWeekString(day, 'short')})
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {employees.length === 0 ? (
                            <div className="py-16 text-center text-slate-400 text-sm">表示する職長がいません</div>
                        ) : (
                            employees.map((emp) => (
                                <div key={emp.id} className="flex border-b border-slate-200 hover:bg-slate-50/50 transition-colors">
                                    <div className="sticky left-0 z-10 bg-white border-r-2 border-slate-200 w-32 min-h-[44px] flex items-center justify-center px-2">
                                        <span className="text-xs font-semibold text-slate-700 text-center break-all">
                                            {emp.name}
                                        </span>
                                    </div>
                                    {days.map((day, idx) => {
                                        const dateKey = formatDateKey(day);
                                        const isCurrent = emp.id === currentEmployeeId && dateKey === currentDateKey;
                                        const isSat = day.getDay() === 6;
                                        const isSun = day.getDay() === 0;
                                        return (
                                            <button
                                                key={idx}
                                                disabled={isSubmitting || isCurrent}
                                                onClick={() => handleCellClick(emp.id, day)}
                                                className={`flex-1 min-w-[80px] border-r border-slate-200 min-h-[44px] flex items-center justify-center transition-all ${
                                                    isCurrent
                                                        ? 'bg-slate-200 cursor-not-allowed'
                                                        : isSubmitting
                                                        ? 'cursor-wait opacity-60'
                                                        : `cursor-pointer ${
                                                              isSat ? 'bg-blue-50/40' : isSun ? 'bg-rose-50/40' : 'bg-white'
                                                          } hover:bg-slate-700 hover:text-white active:bg-slate-800 group`
                                                }`}
                                                title={isCurrent ? '現在のセル' : `${emp.name} / ${formatDate(day, 'short')}に移動`}
                                            >
                                                {isCurrent ? (
                                                    <span className="text-[10px] font-bold text-slate-600">現在</span>
                                                ) : (
                                                    <MoveRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-white" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="flex-shrink-0 flex justify-end px-6 py-3 border-t border-slate-200 bg-slate-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl hover:bg-white transition-colors"
                    >
                        キャンセル
                    </button>
                </div>
            </div>
        </div>
    );
}
