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
    const [morningLoadingMinutes, setMorningLoadingMinutes] = useState(0);
    const [eveningLoadingMinutes, setEveningLoadingMinutes] = useState(0);
    const [earlyStartMinutes, setEarlyStartMinutes] = useState(0);
    const [overtimeMinutes, setOvertimeMinutes] = useState(0);
    const [notes, setNotes] = useState('');
    const [workItems, setWorkItems] = useState<{ assignmentId: string; startTime: string; endTime: string }[]>([]);
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

    // 時間差分を分数で計算
    const calcMinutesDiff = (start: string, end: string): number => {
        const s = parseTimeString(start, 0, 0);
        const e = parseTimeString(end, 0, 0);
        return (e.hour * 60 + e.minute) - (s.hour * 60 + s.minute);
    };

    // 既存の日報データを読み込み
    const loadExistingData = useCallback(async () => {
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
                startTime: item.startTime || '08:00',
                endTime: item.endTime || '17:00',
            })));
        } else {
            // 新規: 配置から作業明細を初期化（デフォルト8:00-17:00）
            setWorkItems(todayAssignments.map(a => ({
                assignmentId: a.id,
                startTime: '08:00',
                endTime: '17:00',
            })));
        }
    }, [effectiveForemanId, dateStr, fetchDailyReports, getDailyReportByForemanAndDate, todayAssignments]);

    useEffect(() => {
        if (effectiveForemanId) {
            loadExistingData();
        }
    }, [effectiveForemanId, dateStr]); // eslint-disable-line react-hooks/exhaustive-deps

    // 案件ごとの時間更新
    const updateWorkItemTime = (assignmentId: string, field: 'startTime' | 'endTime', hour: number, minute: number) => {
        const timeStr = formatTime(hour, minute);
        setWorkItems(prev => {
            const existing = prev.find(w => w.assignmentId === assignmentId);
            if (existing) {
                return prev.map(w => w.assignmentId === assignmentId ? { ...w, [field]: timeStr } : w);
            }
            return [...prev, { assignmentId, startTime: field === 'startTime' ? timeStr : '08:00', endTime: field === 'endTime' ? timeStr : '17:00' }];
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
                workItems: workItems.filter(w => w.startTime && w.endTime),
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
    const totalWorkMinutes = workItems.reduce((sum, w) => {
        const diff = calcMinutesDiff(w.startTime, w.endTime);
        return sum + (diff > 0 ? diff : 0);
    }, 0);

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

            {/* 案件ごとの作業時間入力 */}
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    案件ごとの作業時間
                </h3>

                {todayAssignments.length === 0 ? (
                    <div className="p-4 bg-gray-50 rounded-lg text-gray-500 text-center">
                        この日の配置はありません
                    </div>
                ) : (
                    <div className="space-y-3">
                        {todayAssignments.map(assignment => {
                            const workItem = workItems.find(w => w.assignmentId === assignment.id);
                            const st = parseTimeString(workItem?.startTime, 8, 0);
                            const et = parseTimeString(workItem?.endTime, 17, 0);
                            const diff = workItem ? calcMinutesDiff(workItem.startTime, workItem.endTime) : 0;

                            return (
                                <div key={assignment.id} className="p-3 bg-gray-50 rounded-lg">
                                    <div className="mb-2">
                                        <div className="font-medium text-gray-800">{assignment.title}</div>
                                        {assignment.customer && (
                                            <div className="text-sm text-gray-500">{assignment.customer}</div>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {/* 開始時間 */}
                                        <div className="flex items-center gap-1">
                                            <select
                                                value={st.hour}
                                                onChange={(e) => updateWorkItemTime(assignment.id, 'startTime', Number(e.target.value), st.minute)}
                                                className="px-1 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                            >
                                                {hourOptions.map(h => (
                                                    <option key={h} value={h}>{h}</option>
                                                ))}
                                            </select>
                                            <span className="text-gray-400 text-sm">:</span>
                                            <select
                                                value={st.minute}
                                                onChange={(e) => updateWorkItemTime(assignment.id, 'startTime', st.hour, Number(e.target.value))}
                                                className="px-1 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                            >
                                                {minuteOptions.map(m => (
                                                    <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <span className="text-gray-400">〜</span>
                                        {/* 終了時間 */}
                                        <div className="flex items-center gap-1">
                                            <select
                                                value={et.hour}
                                                onChange={(e) => updateWorkItemTime(assignment.id, 'endTime', Number(e.target.value), et.minute)}
                                                className="px-1 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                            >
                                                {hourOptions.map(h => (
                                                    <option key={h} value={h}>{h}</option>
                                                ))}
                                            </select>
                                            <span className="text-gray-400 text-sm">:</span>
                                            <select
                                                value={et.minute}
                                                onChange={(e) => updateWorkItemTime(assignment.id, 'endTime', et.hour, Number(e.target.value))}
                                                className="px-1 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                            >
                                                {minuteOptions.map(m => (
                                                    <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {diff > 0 && (
                                            <span className="text-sm text-gray-500 ml-2">（{formatMinutes(diff)}）</span>
                                        )}
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
