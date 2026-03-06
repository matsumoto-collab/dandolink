'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { DailyReport, DailyReportInput } from '@/types/dailyReport';
import { X, Clock, Save, Loader2, FileText, Truck, AlertCircle, ChevronLeft, ChevronRight, User, Users } from 'lucide-react';
import { formatDateKey } from '@/utils/employeeUtils';
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

    const dateStr = formatDateKey(selectedDate);

    // 時間セレクト用の定数
    const hourOptions = Array.from({ length: 16 }, (_, i) => i + 6); // 6〜21
    const minuteOptions = [0, 15, 30, 45];
    const durationHourOptions = Array.from({ length: 9 }, (_, i) => i); // 0〜8時間（積込・早出残業用）
    const breakHourOptions = [0, 1, 2]; // 0〜2時間（休憩用）

    // 分数 → {hour, minute} 変換
    const minutesToHourMin = (minutes: number) => ({
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
    });

    // フォーム状態
    const [morningLoadingMinutes, setMorningLoadingMinutes] = useState(0);
    const [eveningLoadingMinutes, setEveningLoadingMinutes] = useState(0);
    const [earlyStartMinutes, setEarlyStartMinutes] = useState(0);
    const [overtimeMinutes, setOvertimeMinutes] = useState(0);
    const [breakMinutes, setBreakMinutes] = useState(0);
    const [notes, setNotes] = useState('');
    const [workItems, setWorkItems] = useState<{ assignmentId: string; startTime: string; endTime: string; breakMinutes: number; workerIds: string[] }[]>([]);
    // 全作業員リスト（チェックリスト用）
    const [allWorkers, setAllWorkers] = useState<{ id: string; displayName: string; role: string }[]>([]);
    // 作業員ドロップダウンが開いているassignmentId
    const [openWorkerDropdown, setOpenWorkerDropdown] = useState<string | null>(null);
    // 既存の日報から読み込んだ案件情報（todayAssignmentsに含まれない場合のフォールバック用）
    const [existingWorkItemInfoMap, setExistingWorkItemInfoMap] = useState<Map<string, { title: string; customer?: string }>>(new Map());
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    // 既存日報 → 詳細ビュー、新規 → 編集モード
    const [isEditMode, setIsEditMode] = useState(!selectedReport);
    const modalRef = useModalKeyboard(isOpen, onClose);

    // 作業員リスト取得
    useEffect(() => {
        if (!isOpen) return;
        const fetchWorkers = async () => {
            try {
                const res = await fetch('/api/dispatch/workers');
                if (res.ok) setAllWorkers(await res.json());
            } catch (e) {
                console.error('Failed to fetch workers:', e);
            }
        };
        fetchWorkers();
    }, [isOpen]);

    // モーダルが開いたときの初期化（foremanId設定）
    useEffect(() => {
        if (isOpen && foremanId) {
            setSelectedForemanId(foremanId);
        } else if (isOpen && !foremanId && isAdminOrManager && allForemen.length > 0) {
            // ログインユーザーが職長リストにいれば優先、なければ先頭
            const myId = session?.user?.id || '';
            const myForeman = allForemen.find(f => f.id === myId);
            setSelectedForemanId(myForeman?.id || allForemen[0].id);
        }
    }, [isOpen, foremanId, isAdminOrManager, allForemen]); // eslint-disable-line react-hooks/exhaustive-deps

    // この日の配置を取得
    const todayAssignments = projects.filter(p => {
        const projectDate = p.startDate instanceof Date ? p.startDate : new Date(p.startDate);
        return formatDateKey(projectDate) === dateStr &&
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

    // モーダルオープン時のみ日付を初期化（日付ナビゲーション時はリセットしない）
    useEffect(() => {
        if (isOpen) setSelectedDate(initialDate || new Date());
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // 日報データの読み込み（リセット + 既存データ取得を一連で行う）
    useEffect(() => {
        if (!isOpen) return;

        // 1) まずフォーム状態をリセット（新規日報のデフォルト = todayAssignmentsから生成）
        setIsEditMode(!selectedReport);
        setMorningLoadingMinutes(0);
        setEveningLoadingMinutes(0);
        setEarlyStartMinutes(0);
        setOvertimeMinutes(0);
        setBreakMinutes(0);
        setNotes('');
        setExistingWorkItemInfoMap(new Map());
        setSaveMessage(null);
        // workItemsはtodayAssignmentsからデフォルト生成（手配確定メンバーをデフォルト選択）
        setWorkItems(todayAssignments.map(a => ({
            assignmentId: a.id,
            startTime: '08:00',
            endTime: '17:00',
            breakMinutes: 0,
            workerIds: a.confirmedWorkerIds || [],
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
                setBreakMinutes(existing.breakMinutes ?? 0);
                setNotes(existing.notes || '');
                setWorkItems(existing.workItems.map(item => {
                    // workerIdsが未保存の場合、手配確定メンバーをフォールバック
                    const savedWorkerIds = item.workerIds && item.workerIds.length > 0 ? item.workerIds : null;
                    const fallbackWorkerIds = todayAssignments.find(a => a.id === item.assignmentId)?.confirmedWorkerIds || [];
                    return {
                        assignmentId: item.assignmentId,
                        startTime: item.startTime || '08:00',
                        endTime: item.endTime || '17:00',
                        breakMinutes: item.breakMinutes ?? 0,
                        workerIds: savedWorkerIds || fallbackWorkerIds,
                    };
                }));
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
            return [...prev, { assignmentId, startTime: field === 'startTime' ? timeStr : '08:00', endTime: field === 'endTime' ? timeStr : '17:00', breakMinutes: 0, workerIds: [] }];
        });
    };

    // 案件ごとの作業員トグル
    const toggleWorker = (assignmentId: string, workerId: string) => {
        setWorkItems(prev => prev.map(w => {
            if (w.assignmentId !== assignmentId) return w;
            const ids = w.workerIds.includes(workerId)
                ? w.workerIds.filter(id => id !== workerId)
                : [...w.workerIds, workerId];
            return { ...w, workerIds: ids };
        }));
    };

    // 案件ごとの休憩時間更新
    const updateWorkItemBreak = (assignmentId: string, minutes: number) => {
        setWorkItems(prev => prev.map(w => w.assignmentId === assignmentId ? { ...w, breakMinutes: minutes } : w));
    };

    // 分を時間:分形式に変換
    const formatMinutes = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${mins.toString().padStart(2, '0')}`;
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
                breakMinutes,
                notes: notes || undefined,
                workItems: workItems.filter(w => w.startTime && w.endTime).map(w => ({
                    assignmentId: w.assignmentId,
                    startTime: w.startTime,
                    endTime: w.endTime,
                    breakMinutes: w.breakMinutes,
                    workerIds: w.workerIds,
                })),
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

    // 総作業時間（休憩差引後）
    const totalNetWorkMinutes = workItems.reduce((sum, w) => {
        const diff = calcMinutesDiff(w.startTime, w.endTime);
        const net = Math.max(0, diff - (w.breakMinutes ?? 0));
        return sum + (net > 0 ? net : 0);
    }, 0);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ（PCのみ） */}
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

                {/* モーダル本体 */}
                <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-2xl lg:mx-4 lg:max-h-[90vh]">
                    {/* Header */}
                    <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200">
                        <h2 className="text-xl font-semibold text-slate-800">
                            {selectedReport && !isEditMode ? '日報詳細' : '日報入力'}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-6 overflow-y-auto">
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
                        <div className="flex items-center justify-center gap-4 bg-slate-50 rounded-lg p-4 mb-6">
                            <button
                                onClick={goPreviousDay}
                                className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5 text-slate-600" />
                            </button>

                            <div className="flex items-center gap-3">
                                <input
                                    type="date"
                                    value={dateStr}
                                    onChange={(e) => setSelectedDate(new Date(e.target.value))}
                                    className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
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
                                className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                <ChevronRight className="w-5 h-5 text-slate-600" />
                            </button>
                        </div>

                        {/* 職長選択（管理者/マネージャーのみ） */}
                        {isAdminOrManager && (
                            <div className="mb-6">
                                <h3 className="text-lg font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                    <User className="w-5 h-5" />
                                    職長選択
                                </h3>
                                <select
                                    value={selectedForemanId}
                                    onChange={(e) => setSelectedForemanId(e.target.value)}
                                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                >
                                    {[...allForemen].sort((a, b) => {
                                        const myId = session?.user?.id || '';
                                        if (a.id === myId) return -1;
                                        if (b.id === myId) return 1;
                                        return 0;
                                    }).map(foreman => (
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
                                    <h3 className="text-lg font-semibold text-slate-700 mb-3 flex items-center gap-2">
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
                                                <div className="p-4 bg-slate-50 rounded-lg text-slate-500 text-center">
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
                                                    const itemBreak = workItem?.breakMinutes ?? 0;
                                                    const netMinutes = Math.max(0, diff - itemBreak);

                                                    return (
                                                        <div key={assignment.id} className="p-3 bg-slate-50 rounded-lg">
                                                            <div className="mb-2">
                                                                <div className="font-medium text-slate-800">{assignment.title}</div>
                                                                {assignment.customer && (
                                                                    <div className="text-sm text-slate-500">{assignment.customer}</div>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                {/* 開始時間 */}
                                                                <div className="flex items-center gap-1">
                                                                    <select
                                                                        value={st.hour}
                                                                        onChange={(e) => updateWorkItemTime(assignment.id, 'startTime', Number(e.target.value), st.minute)}
                                                                        className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                                    >
                                                                        {hourOptions.map(h => (
                                                                            <option key={h} value={h}>{h}</option>
                                                                        ))}
                                                                    </select>
                                                                    <span className="text-slate-400 text-sm">:</span>
                                                                    <select
                                                                        value={st.minute}
                                                                        onChange={(e) => updateWorkItemTime(assignment.id, 'startTime', st.hour, Number(e.target.value))}
                                                                        className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                                    >
                                                                        {minuteOptions.map(m => (
                                                                            <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <span className="text-slate-400">〜</span>
                                                                {/* 終了時間 */}
                                                                <div className="flex items-center gap-1">
                                                                    <select
                                                                        value={et.hour}
                                                                        onChange={(e) => updateWorkItemTime(assignment.id, 'endTime', Number(e.target.value), et.minute)}
                                                                        className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                                    >
                                                                        {hourOptions.map(h => (
                                                                            <option key={h} value={h}>{h}</option>
                                                                        ))}
                                                                    </select>
                                                                    <span className="text-slate-400 text-sm">:</span>
                                                                    <select
                                                                        value={et.minute}
                                                                        onChange={(e) => updateWorkItemTime(assignment.id, 'endTime', et.hour, Number(e.target.value))}
                                                                        className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                                    >
                                                                        {minuteOptions.map(m => (
                                                                            <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            {/* 休憩・実作業時間 */}
                                                            <div className="flex flex-wrap items-center gap-2 mt-2">
                                                                <span className="text-sm text-slate-500">休憩</span>
                                                                <select
                                                                    value={minutesToHourMin(itemBreak).hour}
                                                                    onChange={(e) => updateWorkItemBreak(assignment.id, Number(e.target.value) * 60 + minutesToHourMin(itemBreak).minute)}
                                                                    className="px-1 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                                >
                                                                    {breakHourOptions.map(h => (
                                                                        <option key={h} value={h}>{h}</option>
                                                                    ))}
                                                                </select>
                                                                <span className="text-slate-400 text-xs">時間</span>
                                                                <select
                                                                    value={minutesToHourMin(itemBreak).minute}
                                                                    onChange={(e) => updateWorkItemBreak(assignment.id, minutesToHourMin(itemBreak).hour * 60 + Number(e.target.value))}
                                                                    className="px-1 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                                >
                                                                    {minuteOptions.map(m => (
                                                                        <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                                    ))}
                                                                </select>
                                                                <span className="text-slate-400 text-xs">分</span>
                                                                {diff > 0 && (
                                                                    <span className="text-sm text-slate-600 ml-auto">
                                                                        実作業 <span className="font-bold">{formatMinutes(netMinutes)}</span>
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* 作業員セレクター */}
                                                            <div className="mt-3 pt-2 border-t border-slate-200 relative">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setOpenWorkerDropdown(openWorkerDropdown === assignment.id ? null : assignment.id)}
                                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50 transition-colors"
                                                                    >
                                                                        <Users className="w-3.5 h-3.5" />
                                                                        作業員
                                                                        <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-xs font-medium">
                                                                            {workItem?.workerIds?.length || 0}
                                                                        </span>
                                                                    </button>
                                                                    {(workItem?.workerIds || []).map(id => {
                                                                        const w = allWorkers.find(w => w.id === id);
                                                                        return (
                                                                            <span key={id} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 pl-2 pr-1 py-1 rounded-full">
                                                                                {w?.displayName || (allWorkers.length === 0 ? '...' : id)}
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => toggleWorker(assignment.id, id)}
                                                                                    className="w-4 h-4 rounded-full hover:bg-slate-300 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
                                                                                >
                                                                                    ×
                                                                                </button>
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </div>
                                                                {openWorkerDropdown === assignment.id && (
                                                                    <>
                                                                        <div className="fixed inset-0 z-10" onClick={() => setOpenWorkerDropdown(null)} />
                                                                        <div className="absolute left-0 mt-1 z-20 w-64 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                                                                            {allWorkers.map(worker => {
                                                                                const isSelected = workItem?.workerIds?.includes(worker.id) || false;
                                                                                return (
                                                                                    <button
                                                                                        key={worker.id}
                                                                                        type="button"
                                                                                        onClick={() => toggleWorker(assignment.id, worker.id)}
                                                                                        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50 transition-colors text-left"
                                                                                    >
                                                                                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                                                                                            isSelected ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-300'
                                                                                        }`}>
                                                                                            {isSelected && <span className="text-xs">✓</span>}
                                                                                        </span>
                                                                                        <span className="text-slate-700">{worker.displayName}</span>
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                <div className="flex justify-end text-sm text-slate-600 pt-2 border-t border-slate-200 mt-2">
                                                    合計: <span className="font-bold ml-1">{formatMinutes(totalNetWorkMinutes)}</span>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* 積込時間 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                        <Truck className="w-5 h-5" />
                                        積込時間
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-600 mb-1">朝積込</label>
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={minutesToHourMin(morningLoadingMinutes).hour}
                                                    onChange={(e) => setMorningLoadingMinutes(Number(e.target.value) * 60 + minutesToHourMin(morningLoadingMinutes).minute)}
                                                    className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                >
                                                    {durationHourOptions.map(h => (
                                                        <option key={h} value={h}>{h}</option>
                                                    ))}
                                                </select>
                                                <span className="text-slate-400 text-sm">時間</span>
                                                <select
                                                    value={minutesToHourMin(morningLoadingMinutes).minute}
                                                    onChange={(e) => setMorningLoadingMinutes(minutesToHourMin(morningLoadingMinutes).hour * 60 + Number(e.target.value))}
                                                    className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                >
                                                    {minuteOptions.map(m => (
                                                        <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                    ))}
                                                </select>
                                                <span className="text-slate-400 text-sm">分</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-600 mb-1">夕積込</label>
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={minutesToHourMin(eveningLoadingMinutes).hour}
                                                    onChange={(e) => setEveningLoadingMinutes(Number(e.target.value) * 60 + minutesToHourMin(eveningLoadingMinutes).minute)}
                                                    className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                >
                                                    {durationHourOptions.map(h => (
                                                        <option key={h} value={h}>{h}</option>
                                                    ))}
                                                </select>
                                                <span className="text-slate-400 text-sm">時間</span>
                                                <select
                                                    value={minutesToHourMin(eveningLoadingMinutes).minute}
                                                    onChange={(e) => setEveningLoadingMinutes(minutesToHourMin(eveningLoadingMinutes).hour * 60 + Number(e.target.value))}
                                                    className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                >
                                                    {minuteOptions.map(m => (
                                                        <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                    ))}
                                                </select>
                                                <span className="text-slate-400 text-sm">分</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 早出・残業 */}
                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                        <Clock className="w-5 h-5" />
                                        早出・残業
                                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">按分方法は保留</span>
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-600 mb-1">早出</label>
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={minutesToHourMin(earlyStartMinutes).hour}
                                                    onChange={(e) => setEarlyStartMinutes(Number(e.target.value) * 60 + minutesToHourMin(earlyStartMinutes).minute)}
                                                    className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                >
                                                    {durationHourOptions.map(h => (
                                                        <option key={h} value={h}>{h}</option>
                                                    ))}
                                                </select>
                                                <span className="text-slate-400 text-sm">時間</span>
                                                <select
                                                    value={minutesToHourMin(earlyStartMinutes).minute}
                                                    onChange={(e) => setEarlyStartMinutes(minutesToHourMin(earlyStartMinutes).hour * 60 + Number(e.target.value))}
                                                    className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                >
                                                    {minuteOptions.map(m => (
                                                        <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                    ))}
                                                </select>
                                                <span className="text-slate-400 text-sm">分</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-600 mb-1">残業</label>
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={minutesToHourMin(overtimeMinutes).hour}
                                                    onChange={(e) => setOvertimeMinutes(Number(e.target.value) * 60 + minutesToHourMin(overtimeMinutes).minute)}
                                                    className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                >
                                                    {durationHourOptions.map(h => (
                                                        <option key={h} value={h}>{h}</option>
                                                    ))}
                                                </select>
                                                <span className="text-slate-400 text-sm">時間</span>
                                                <select
                                                    value={minutesToHourMin(overtimeMinutes).minute}
                                                    onChange={(e) => setOvertimeMinutes(minutesToHourMin(overtimeMinutes).hour * 60 + Number(e.target.value))}
                                                    className="px-1 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                                                >
                                                    {minuteOptions.map(m => (
                                                        <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                                    ))}
                                                </select>
                                                <span className="text-slate-400 text-sm">分</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 備考 */}
                                <div>
                                    <h3 className="text-lg font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                        <FileText className="w-5 h-5" />
                                        備考
                                    </h3>
                                    <textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        rows={3}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
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
                    <div className="flex-shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
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
    );
}
