'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useProjects } from '@/hooks/useProjects';
import { DailyReportInput } from '@/types/dailyReport';
import { Clock, Save, Loader2, FileText, Truck, AlertCircle } from 'lucide-react';

interface DailyReportFormProps {
    date: Date;
    foremanId?: string; // 指定がなければ現在のユーザー
    onSaved?: () => void;
}

export default function DailyReportForm({ date, foremanId, onSaved }: DailyReportFormProps) {
    const { data: session } = useSession();
    const { saveDailyReport, getDailyReportByForemanAndDate, fetchDailyReports } = useDailyReports();
    const { projects } = useProjects();

    const effectiveForemanId = foremanId || session?.user?.id || '';
    const dateStr = date.toISOString().split('T')[0];

    // 時間セレクト用の定数
    const hourOptions = Array.from({ length: 16 }, (_, i) => i + 6); // 6〜21
    const minuteOptions = [0, 15, 30, 45];

    // フォーム状態
    const [startHour, setStartHour] = useState(8);
    const [startMinute, setStartMinute] = useState(0);
    const [endHour, setEndHour] = useState(17);
    const [endMinute, setEndMinute] = useState(0);
    const [morningLoadingMinutes, setMorningLoadingMinutes] = useState(0);
    const [eveningLoadingMinutes, setEveningLoadingMinutes] = useState(0);
    const [earlyStartMinutes, setEarlyStartMinutes] = useState(0);
    const [overtimeMinutes, setOvertimeMinutes] = useState(0);
    const [notes, setNotes] = useState('');
    const [workItems, setWorkItems] = useState<{ assignmentId: string; workMinutes: number }[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // この日の配置を取得
    const todayAssignments = projects.filter(p => {
        const projectDate = p.startDate instanceof Date ? p.startDate : new Date(p.startDate);
        return projectDate.toISOString().split('T')[0] === dateStr &&
            p.assignedEmployeeId === effectiveForemanId;
    });

    // 時間文字列をパース ("HH:MM" → hour, minute)
    const parseTimeString = (timeStr: string | null | undefined, defaultHour: number, defaultMinute: number) => {
        if (!timeStr) return { hour: defaultHour, minute: defaultMinute };
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            return { hour: parseInt(parts[0]) || defaultHour, minute: parseInt(parts[1]) || defaultMinute };
        }
        return { hour: defaultHour, minute: defaultMinute };
    };

    // 時間をフォーマット (hour, minute → "HH:MM")
    const formatTime = (hour: number, minute: number): string => {
        return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    };

    // 既存の日報データを読み込み
    const loadExistingData = useCallback(async () => {
        await fetchDailyReports({ foremanId: effectiveForemanId, date: dateStr });
        const existing = getDailyReportByForemanAndDate(effectiveForemanId, dateStr);
        if (existing) {
            const start = parseTimeString(existing.startTime, 8, 0);
            const end = parseTimeString(existing.endTime, 17, 0);
            setStartHour(start.hour);
            setStartMinute(start.minute);
            setEndHour(end.hour);
            setEndMinute(end.minute);
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
            setStartHour(8);
            setStartMinute(0);
            setEndHour(17);
            setEndMinute(0);
            setWorkItems(todayAssignments.map(a => ({
                assignmentId: a.id,
                workMinutes: 480, // 8時間
            })));
        }
    }, [effectiveForemanId, dateStr, fetchDailyReports, getDailyReportByForemanAndDate, todayAssignments]);

    useEffect(() => {
        if (effectiveForemanId) {
            loadExistingData();
        }
    }, [effectiveForemanId, dateStr]); // eslint-disable-line react-hooks/exhaustive-deps

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
                startTime: formatTime(startHour, startMinute),
                endTime: formatTime(endHour, endMinute),
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
        } catch (error) {
            console.error('Failed to save:', error);
            setSaveMessage({ type: 'error', text: '保存に失敗しました' });
        } finally {
            setIsSaving(false);
        }
    };

    // 総作業時間
    const totalWorkMinutes = workItems.reduce((sum, w) => sum + w.workMinutes, 0);

    if (!effectiveForemanId) {
        return (
            <div className="p-4 bg-yellow-50 rounded-lg text-yellow-800">
                <AlertCircle className="w-5 h-5 inline mr-2" />
                ログインしてください
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-lg p-6">
            {/* ヘッダー */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">日報入力</h2>
                    <div className="text-sm text-gray-500">
                        {date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    保存
                </button>
            </div>

            {/* メッセージ */}
            {saveMessage && (
                <div className={`mb-4 p-3 rounded-lg ${saveMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                    {saveMessage.text}
                </div>
            )}

            {/* 開始・終了時間 */}
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    開始・終了時間
                </h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">開始時間</label>
                        <div className="flex items-center gap-1">
                            <select
                                value={startHour}
                                onChange={(e) => setStartHour(Number(e.target.value))}
                                className="flex-1 px-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                                {hourOptions.map(h => (
                                    <option key={h} value={h}>{h}時</option>
                                ))}
                            </select>
                            <span className="text-gray-400">:</span>
                            <select
                                value={startMinute}
                                onChange={(e) => setStartMinute(Number(e.target.value))}
                                className="w-20 px-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                                {minuteOptions.map(m => (
                                    <option key={m} value={m}>{m.toString().padStart(2, '0')}分</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">終了時間</label>
                        <div className="flex items-center gap-1">
                            <select
                                value={endHour}
                                onChange={(e) => setEndHour(Number(e.target.value))}
                                className="flex-1 px-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                                {hourOptions.map(h => (
                                    <option key={h} value={h}>{h}時</option>
                                ))}
                            </select>
                            <span className="text-gray-400">:</span>
                            <select
                                value={endMinute}
                                onChange={(e) => setEndMinute(Number(e.target.value))}
                                className="w-20 px-2 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                                {minuteOptions.map(m => (
                                    <option key={m} value={m}>{m.toString().padStart(2, '0')}分</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

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

            {/* 早出・残業（保留だが入力は可能に） */}
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
        </div>
    );
}
