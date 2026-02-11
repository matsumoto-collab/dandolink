'use client';

import React, { useState, useEffect } from 'react';
import { CalendarEvent, Employee } from '@/types/calendar';
import { X, Copy, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface CopyAssignmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    event: CalendarEvent | null;
    employees: Employee[];
    onCopy: (startDate: Date, endDate: Date, employeeId: string) => Promise<void>;
}

export default function CopyAssignmentModal({
    isOpen,
    onClose,
    event,
    employees,
    onCopy,
}: CopyAssignmentModalProps) {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [employeeId, setEmployeeId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dateCount, setDateCount] = useState(0);
    const modalRef = useModalKeyboard(isOpen, onClose);

    // 初期値設定
    useEffect(() => {
        if (isOpen && event) {
            // デフォルト: 翌日
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const dateStr = tomorrow.toISOString().split('T')[0];
            setStartDate(dateStr);
            setEndDate(dateStr);
            setEmployeeId(event.assignedEmployeeId || '');
        }
    }, [isOpen, event]);

    // 日数計算
    useEffect(() => {
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (end >= start) {
                const diffTime = Math.abs(end.getTime() - start.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                setDateCount(diffDays);
            } else {
                setDateCount(0);
            }
        }
    }, [startDate, endDate]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!startDate || !endDate || !employeeId) return;

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (end < start) {
            toast.error('終了日は開始日以降に設定してください');
            return;
        }

        setIsSubmitting(true);
        try {
            await onCopy(start, end, employeeId);
            onClose();
        } catch (error) {
            console.error('Failed to copy assignment:', error);
            toast.error('コピーに失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen || !event) return null;

    return (
        <>
            {/* オーバーレイ */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-50"
                onClick={onClose}
            />

            {/* モーダル */}
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
                <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="bg-white rounded-lg shadow-lg w-full max-w-md" onClick={e => e.stopPropagation()}>
                    {/* ヘッダー */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                        <div className="flex items-center gap-2">
                            <Copy className="w-5 h-5 text-slate-600" />
                            <h2 className="text-lg font-semibold text-gray-800">案件をコピー</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* コンテンツ */}
                    <form onSubmit={handleSubmit} className="p-6 space-y-4">
                        {/* コピー元情報 */}
                        <div className="bg-gray-50 rounded-lg p-4">
                            <div className="text-sm text-gray-500 mb-1">コピー元</div>
                            <div className="font-medium text-gray-900">{event.title}</div>
                            {event.customer && (
                                <div className="text-sm text-gray-600">{event.customer}</div>
                            )}
                        </div>

                        {/* 職長選択 */}
                        <div>
                            <label htmlFor="employeeId" className="block text-sm font-medium text-gray-700 mb-1">
                                職長
                            </label>
                            <select
                                id="employeeId"
                                value={employeeId}
                                onChange={(e) => setEmployeeId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                required
                            >
                                <option value="">選択してください</option>
                                {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 日付範囲 */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
                                    <Calendar className="w-4 h-4 inline mr-1" />
                                    開始日
                                </label>
                                <input
                                    id="startDate"
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => {
                                        setStartDate(e.target.value);
                                        if (e.target.value > endDate) {
                                            setEndDate(e.target.value);
                                        }
                                    }}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
                                    <Calendar className="w-4 h-4 inline mr-1" />
                                    終了日
                                </label>
                                <input
                                    id="endDate"
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    min={startDate}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>
                        </div>

                        {/* 日数表示 */}
                        {dateCount > 0 && (
                            <div className="text-sm text-gray-600 text-center">
                                <span className="font-medium text-blue-600">{dateCount}日間</span>
                                の案件が作成されます
                            </div>
                        )}

                        {/* ボタン */}
                        <div className="flex justify-end gap-3 pt-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                キャンセル
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting || dateCount === 0}
                                className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        コピー中...
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" />
                                        コピー
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
}
