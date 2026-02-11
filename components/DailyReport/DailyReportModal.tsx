'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { DailyReportInput } from '@/types/dailyReport';
import { X, Clock, Save, Loader2, FileText, Truck, AlertCircle, ChevronLeft, ChevronRight, User } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface DailyReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialDate?: Date;
    foremanId?: string;
    onSaved?: () => void;
}

export default function DailyReportModal({ isOpen, onClose, initialDate, foremanId, onSaved }: DailyReportModalProps) {
    const { data: session } = useSession();
    const { saveDailyReport, getDailyReportByForemanAndDate, fetchDailyReports } = useDailyReports();
    const { projects } = useProjects();
    const { allForemen } = useCalendarDisplay();

    const [selectedDate, setSelectedDate] = useState(initialDate || new Date());
    const [selectedForemanId, setSelectedForemanId] = useState<string>(foremanId || '');

    // 管理者またはマネージャーかどうか
    const userRole = session?.user?.role;
    const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

    // 職長IDの決定: 管理者/マネージャーは選択可能、それ以外は自分のID
    const effectiveForemanId = isAdminOrManager
        ? (selectedForemanId || foremanId || session?.user?.id || '')
        : (foremanId || session?.user?.id || '');

    const dateStr = selectedDate.toISOString().split('T')[0];

    // フォーム状態
    const [morningLoadingMinutes, setMorningLoadingMinutes] = useState(0);
    const [eveningLoadingMinutes, setEveningLoadingMinutes] = useState(0);
    const [earlyStartMinutes, setEarlyStartMinutes] = useState(0);
    const [overtimeMinutes, setOvertimeMinutes] = useState(0);
    const [notes, setNotes] = useState('');
    const [workItems, setWorkItems] = useState<{ assignmentId: string; workMinutes: number }[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const modalRef = useModalKeyboard(isOpen, onClose);

    // 初期値の設定（モーダルが開いたとき）
    useEffect(() => {
        if (isOpen && foremanId) {
            setSelectedForemanId(foremanId);
        } else if (isOpen && !foremanId && isAdminOrManager && allForemen.length > 0) {
            // 新規作成で管理者/マネージャーの場合、最初の職長を選択
            setSelectedForemanId(allForemen[0].id);
        }
    }, [isOpen, foremanId, isAdminOrManager, allForemen]);

    // この日の配置を取得
    const todayAssignments = projects.filter(p => {
        const projectDate = p.startDate instanceof Date ? p.startDate : new Date(p.startDate);
        return projectDate.toISOString().split('T')[0] === dateStr &&
            p.assignedEmployeeId === effectiveForemanId;
    });

    // 既存の日報データを読み込み
    const loadExistingData = useCallback(async () => {
        if (!effectiveForemanId) return;

        await fetchDailyReports({ foremanId: effectiveForemanId, date: dateStr });
        const existing = getDailyReportByForemanAndDate(effectiveForemanId, dateStr);
        if (existing) {
            setMorningLoadingMinutes(existing.morningLoadingMinutes);
            setEveningLoadingMinutes(existing.eveningLoadingMinutes);
            setEarlyStartMinutes(existing.earlyStartMinutes);
            setOvertimeMinutes(existing.overtimeMinutes);
            setNotes(existing.notes || '');
            setWorkItems(existing.workItems.map(item => ({
                assignmentId: item.assignmentId,
                workMinutes: item.workMinutes,
            })));
        } else {
            // 新規: 配置から作業明細を初期化（デフォルト8時間）
            setMorningLoadingMinutes(0);
            setEveningLoadingMinutes(0);
            setEarlyStartMinutes(0);
            setOvertimeMinutes(0);
            setNotes('');
            setWorkItems(todayAssignments.map(a => ({
                assignmentId: a.id,
                workMinutes: 480, // 8時間
            })));
        }
    }, [effectiveForemanId, dateStr, fetchDailyReports, getDailyReportByForemanAndDate, todayAssignments]);

    useEffect(() => {
        if (isOpen && effectiveForemanId) {
            loadExistingData();
        }
    }, [isOpen, effectiveForemanId, dateStr]); // eslint-disable-line react-hooks/exhaustive-deps

    // 日付ナビゲーション
    const goPreviousDay = () => {
        const newDate = new Date(selectedDate);
        newDate.setDate(newDate.getDate() - 1);
        setSelectedDate(newDate);
    };

    const goNextDay = () => {
        const newDate = new Date(selectedDate);
        newDate.setDate(newDate.getDate() + 1);
        setSelectedDate(newDate);
    };

    const goToday = () => {
        setSelectedDate(new Date());
    };

    // 作業時間の更新
    const updateWorkMinutes = (assignmentId: string, minutes: number) => {
        setWorkItems(prev => {
            const existing = prev.find(w => w.assignmentId === assignmentId);
            if (existing) {
                return prev.map(w => w.assignmentId === assignmentId ? { ...w, workMinutes: minutes } : w);
            }
            return [...prev, { assignmentId, workMinutes: minutes }];
        });
    };

    // 分を時間:分形式に変換
    const formatMinutes = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${mins.toString().padStart(2, '0')}`;
    };

    // 時間:分形式を分に変換
    const parseTimeToMinutes = (timeStr: string): number => {
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            const hours = parseInt(parts[0]) || 0;
            const mins = parseInt(parts[1]) || 0;
            return hours * 60 + mins;
        }
        return parseInt(timeStr) || 0;
    };

    // 保存
    const handleSave = async () => {
        if (!effectiveForemanId) {
            setSaveMessage({ type: 'error', text: 'ログインが必要です' });
            return;
        }

        setIsSaving(true);
        setSaveMessage(null);

        try {
            const input: DailyReportInput = {
                foremanId: effectiveForemanId,
                date: dateStr,
                morningLoadingMinutes,
                eveningLoadingMinutes,
                earlyStartMinutes,
                overtimeMinutes,
                notes: notes || undefined,
                workItems: workItems.filter(w => w.workMinutes > 0),
            };

            await saveDailyReport(input);
            setSaveMessage({ type: 'success', text: '日報を保存しました' });
            onSaved?.();

            // 少し待ってからモーダルを閉じる
            setTimeout(() => {
                onClose();
            }, 1000);
        } catch (error) {
            console.error('Failed to save:', error);
            setSaveMessage({ type: 'error', text: '保存に失敗しました' });
        } finally {
            setIsSaving(false);
        }
    };

    // 総作業時間
    const totalWorkMinutes = workItems.reduce((sum, w) => sum + w.workMinutes, 0);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
                {/* Backdrop */}
                <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} />

                {/* Modal */}
                <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative inline-block w-full max-w-2xl bg-white rounded-lg shadow-lg transform transition-all text-left overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                        <h2 className="text-xl font-semibold text-gray-800">日報入力</h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-500" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 max-h-[calc(100vh-200px)] overflow-y-auto">
                        {/* 日付ナビゲーション */}
                        <div className="flex items-center justify-center gap-4 bg-gray-50 rounded-lg p-4 mb-6">
                            <button
                                onClick={goPreviousDay}
                                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5 text-gray-600" />
                            </button>

                            <div className="flex items-center gap-3">
                                <input
                                    type="date"
                                    value={dateStr}
                                    onChange={(e) => setSelectedDate(new Date(e.target.value))}
                                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button
                                    onClick={goToday}
                                    className="px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                                >
                                    今日
                                </button>
                            </div>

                            <button
                                onClick={goNextDay}
                                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                <ChevronRight className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>

                        {/* 職長選択（管理者/マネージャーのみ） */}
                        {isAdminOrManager && (
                            <div className="mb-6">
                                <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                    <User className="w-5 h-5" />
                                    職長選択
                                </h3>
                                <select
                                    value={selectedForemanId}
                                    onChange={(e) => setSelectedForemanId(e.target.value)}
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                >
                                    {allForemen.map(foreman => (
                                        <option key={foreman.id} value={foreman.id}>
                                            {foreman.displayName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* メッセージ */}
                        {saveMessage && (
                            <div className={`mb-4 p-3 rounded-lg ${saveMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                                {saveMessage.text}
                            </div>
                        )}

                        {!effectiveForemanId ? (
                            <div className="p-4 bg-yellow-50 rounded-lg text-yellow-800">
                                <AlertCircle className="w-5 h-5 inline mr-2" />
                                ログインしてください
                            </div>
                        ) : (
                            <>
                                {/* 作業時間入力 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                        <Clock className="w-5 h-5" />
                                        作業時間
                                    </h3>

                                    {todayAssignments.length === 0 ? (
                                        <div className="p-4 bg-gray-50 rounded-lg text-gray-500 text-center">
                                            この日の配置はありません
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {todayAssignments.map(assignment => {
                                                const workItem = workItems.find(w => w.assignmentId === assignment.id);
                                                const minutes = workItem?.workMinutes || 0;

                                                return (
                                                    <div key={assignment.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                                                        <div className="flex-1">
                                                            <div className="font-medium text-gray-800">{assignment.title}</div>
                                                            {assignment.customer && (
                                                                <div className="text-sm text-gray-500">{assignment.customer}</div>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                value={formatMinutes(minutes)}
                                                                onChange={(e) => updateWorkMinutes(assignment.id, parseTimeToMinutes(e.target.value))}
                                                                className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                placeholder="0:00"
                                                            />
                                                            <span className="text-sm text-gray-500">（時:分）</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            <div className="flex justify-end text-sm text-gray-600">
                                                合計: <span className="font-bold ml-1">{formatMinutes(totalWorkMinutes)}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* 積込時間 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                        <Truck className="w-5 h-5" />
                                        積込時間
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-600 mb-1">朝積込</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={formatMinutes(morningLoadingMinutes)}
                                                    onChange={(e) => setMorningLoadingMinutes(parseTimeToMinutes(e.target.value))}
                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                                <span className="text-sm text-gray-500">（時:分）</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-600 mb-1">夕積込</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={formatMinutes(eveningLoadingMinutes)}
                                                    onChange={(e) => setEveningLoadingMinutes(parseTimeToMinutes(e.target.value))}
                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                                <span className="text-sm text-gray-500">（時:分）</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 早出・残業 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                        <Clock className="w-5 h-5" />
                                        早出・残業
                                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">按分方法は保留</span>
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-600 mb-1">早出</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={formatMinutes(earlyStartMinutes)}
                                                    onChange={(e) => setEarlyStartMinutes(parseTimeToMinutes(e.target.value))}
                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                                <span className="text-sm text-gray-500">（時:分）</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-600 mb-1">残業</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={formatMinutes(overtimeMinutes)}
                                                    onChange={(e) => setOvertimeMinutes(parseTimeToMinutes(e.target.value))}
                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                                <span className="text-sm text-gray-500">（時:分）</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 備考 */}
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                        <FileText className="w-5 h-5" />
                                        備考
                                    </h3>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        rows={3}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="備考があれば入力..."
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            キャンセル
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving || !effectiveForemanId}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                        >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            保存
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
