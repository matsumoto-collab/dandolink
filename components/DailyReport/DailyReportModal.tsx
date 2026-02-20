'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { DailyReport, DailyReportInput } from '@/types/dailyReport';
import { X, Clock, Save, Loader2, FileText, Truck, AlertCircle, ChevronLeft, ChevronRight, User } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import DailyReportDetailView from './DailyReportDetailView';

interface DailyReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialDate?: Date;
    foremanId?: string;
    selectedReport?: DailyReport | null;
    onSaved?: () => void;
    onDelete?: (id: string) => void;
}

export default function DailyReportModal({ isOpen, onClose, initialDate, foremanId, selectedReport, onSaved, onDelete }: DailyReportModalProps) {
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
    // 既存の日報から読み込んだ案件情報（todayAssignmentsに含まれない場合のフォールバック用）
    const [existingWorkItemInfoMap, setExistingWorkItemInfoMap] = useState<Map<string, { title: string; customer?: string }>>(new Map());
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    // 既存日報 → 詳細ビュー、新規 → 編集モード
    const [isEditMode, setIsEditMode] = useState(!selectedReport);
    const modalRef = useModalKeyboard(isOpen, onClose);

    // モーダルが開いたときの初期化（foremanId設定）
    useEffect(() => {
        if (isOpen && foremanId) {
            setSelectedForemanId(foremanId);
        } else if (isOpen && !foremanId && isAdminOrManager && allForemen.length > 0) {
            setSelectedForemanId(allForemen[0].id);
        }
    }, [isOpen, foremanId, isAdminOrManager, allForemen]);

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

    // 日報データの読み込み（リセット + 既存データ取得を一連で行う）
    useEffect(() => {
        if (!isOpen) return;

        // 1) まずフォーム状態をリセット（新規日報のデフォルト = todayAssignmentsから生成）
        setIsEditMode(!selectedReport);
        setSelectedDate(initialDate || new Date());
        setMorningLoadingMinutes(0);
        setEveningLoadingMinutes(0);
        setEarlyStartMinutes(0);
        setOvertimeMinutes(0);
        setNotes('');
        setExistingWorkItemInfoMap(new Map());
        setSaveMessage(null);
        // workItemsはtodayAssignmentsからデフォルト生成（即座に表示される）
        setWorkItems(todayAssignments.map(a => ({
            assignmentId: a.id,
            startTime: '08:00',
            endTime: '17:00',
        })));

        // 2) 既存の日報があれば非同期で上書き
        if (!effectiveForemanId) return;

        let cancelled = false;

        const loadExistingData = async () => {
            await fetchDailyReports({ foremanId: effectiveForemanId, date: dateStr });
            if (cancelled) return;

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
                const infoMap = new Map<string, { title: string; customer?: string }>();
                for (const item of existing.workItems) {
                    if (item.assignment?.projectMaster) {
                        infoMap.set(item.assignmentId, {
                            title: item.assignment.projectMaster.title,
                            customer: item.assignment.projectMaster.customerName || undefined,
                        });
                    }
                }
                setExistingWorkItemInfoMap(infoMap);
            }
            // existing がない場合は上のリセットで設定済みのデフォルトがそのまま使われる
        };

        loadExistingData();

        return () => { cancelled = true; };
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
    const totalWorkMinutes = workItems.reduce((sum, w) => {
        const diff = calcMinutesDiff(w.startTime, w.endTime);
        return sum + (diff > 0 ? diff : 0);
    }, 0);

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
                        <h2 className="text-xl font-semibold text-gray-800">
                            {selectedReport && !isEditMode ? '日報詳細' : '日報入力'}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-500" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 max-h-[calc(100vh-200px)] overflow-y-auto">
                    {/* 詳細ビュー（既存日報 + 非編集モード） */}
                    {selectedReport && !isEditMode ? (
                        <DailyReportDetailView
                            report={selectedReport}
                            onEdit={() => setIsEditMode(true)}
                            onClose={onClose}
                            onDelete={() => {
                                if (onDelete) {
                                    onDelete(selectedReport.id);
                                    onClose();
                                }
                            }}
                        />
                    ) : (
                    <>
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
                                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                />
                                <button
                                    onClick={goToday}
                                    className="px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
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
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
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
                            <div className={`mb-4 p-3 rounded-lg ${saveMessage.type === 'success' ? 'bg-slate-50 text-slate-700' : 'bg-slate-50 text-slate-700'}`}>
                                {saveMessage.text}
                            </div>
                        )}

                        {!effectiveForemanId ? (
                            <div className="p-4 bg-slate-50 rounded-lg text-slate-700">
                                <AlertCircle className="w-5 h-5 inline mr-2" />
                                ログインしてください
                            </div>
                        ) : (
                            <>
                                {/* 案件ごとの作業時間入力 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                        <Clock className="w-5 h-5" />
                                        案件ごとの作業時間
                                    </h3>

                                    {(() => {
                                        // todayAssignmentsと既存workItemsをマージして表示用リストを構築
                                        const assignmentIds = new Set(todayAssignments.map(a => a.id));
                                        const displayItems: { id: string; title: string; customer?: string }[] = [
                                            ...todayAssignments.map(a => ({ id: a.id, title: a.title, customer: a.customer })),
                                        ];
                                        // 既存workItemsにあるがtodayAssignmentsにないassignmentを追加
                                        for (const wi of workItems) {
                                            if (!assignmentIds.has(wi.assignmentId)) {
                                                const info = existingWorkItemInfoMap.get(wi.assignmentId);
                                                displayItems.push({
                                                    id: wi.assignmentId,
                                                    title: info?.title || '(案件名不明)',
                                                    customer: info?.customer,
                                                });
                                                assignmentIds.add(wi.assignmentId);
                                            }
                                        }

                                        if (displayItems.length === 0) {
                                            return (
                                                <div className="p-4 bg-gray-50 rounded-lg text-gray-500 text-center">
                                                    この日の配置はありません
                                                </div>
                                            );
                                        }

                                        return (
                                            <div className="space-y-3">
                                                {displayItems.map(assignment => {
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
                                                                        className="px-1 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                                    >
                                                                        {hourOptions.map(h => (
                                                                            <option key={h} value={h}>{h}</option>
                                                                        ))}
                                                                    </select>
                                                                    <span className="text-gray-400 text-sm">:</span>
                                                                    <select
                                                                        value={st.minute}
                                                                        onChange={(e) => updateWorkItemTime(assignment.id, 'startTime', st.hour, Number(e.target.value))}
                                                                        className="px-1 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
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
                                                                        className="px-1 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                                    >
                                                                        {hourOptions.map(h => (
                                                                            <option key={h} value={h}>{h}</option>
                                                                        ))}
                                                                    </select>
                                                                    <span className="text-gray-400 text-sm">:</span>
                                                                    <select
                                                                        value={et.minute}
                                                                        onChange={(e) => updateWorkItemTime(assignment.id, 'endTime', et.hour, Number(e.target.value))}
                                                                        className="px-1 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
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
                                        );
                                    })()}
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
                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-slate-500"
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
                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-slate-500"
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
                                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">按分方法は保留</span>
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-600 mb-1">早出</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={formatMinutes(earlyStartMinutes)}
                                                    onChange={(e) => setEarlyStartMinutes(parseTimeToMinutes(e.target.value))}
                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-slate-500"
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
                                                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-slate-500"
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
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="備考があれば入力..."
                                    />
                                </div>
                            </>
                        )}
                    </>
                    )}
                    </div>

                    {/* Footer（編集モード時のみ表示） */}
                    {(isEditMode || !selectedReport) && (
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
                    )}
                </div>
            </div>
        </div>
    );
}
