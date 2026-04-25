'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import imageCompression from 'browser-image-compression';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useCalendarStore } from '@/stores/calendarStore';
import { DailyReport, DailyReportInput } from '@/types/dailyReport';
import { X, Clock, Save, Loader2, FileText, AlertCircle, ChevronLeft, ChevronRight, User, Users, Play, Square, ImagePlus, Trash2 } from 'lucide-react';
import { formatDateKey } from '@/utils/employeeUtils';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import DailyReportDetailView from './DailyReportDetailView';
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';
import { logger } from '@/lib/logger';

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
    const { projects, fetchForDateRange } = useProjects();
    const { allForemen } = useCalendarDisplay();
    const upsertAssignmentStore = useCalendarStore((s) => s.upsertAssignment);

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
    const [workStatusBusy, setWorkStatusBusy] = useState<Record<string, boolean>>({});
    // 開始/完了時の一言メモ入力モーダル
    const [commentPrompt, setCommentPrompt] = useState<{ assignmentId: string; projectMasterId: string; type: 'start' | 'end'; title: string } | null>(null);
    const [commentText, setCommentText] = useState('');
    // 画像アップロード用の状態
    type ImageCategory = 'assembly' | 'demolition' | 'other';
    const [imageCategory, setImageCategory] = useState<ImageCategory | null>(null);
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
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
                logger.error('Failed to fetch workers:', e);
            }
        };
        fetchWorkers();
    }, [isOpen]);

    // モーダルが開いた時・日付変更時にアサインメントを取得
    // 境界問題を避けるため選択日の前後1日も含めて取得する
    useEffect(() => {
        if (!isOpen) return;
        const start = new Date(selectedDate);
        start.setDate(start.getDate() - 1);
        const end = new Date(selectedDate);
        end.setDate(end.getDate() + 1);
        fetchForDateRange(start, end);
    }, [isOpen, selectedDate, fetchForDateRange]);

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
    // 自分の日報を編集中の場合は「自分が職長 OR 確定メンバー」の案件を表示し、
    // 管理者・マネージャーが他人の日報を見るときは従来どおり担当職長の案件のみ表示
    const isOwnReport = effectiveForemanId === session?.user?.id;
    const todayAssignments = projects.filter(p => {
        const projectDate = p.startDate instanceof Date ? p.startDate : new Date(p.startDate);
        if (formatDateKey(projectDate) !== dateStr) return false;
        if (p.assignedEmployeeId === effectiveForemanId) return true;
        if (isOwnReport && (p.confirmedWorkerIds || []).includes(effectiveForemanId)) return true;
        return false;
    }).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

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
                        const pm = item.assignment.projectMaster;
                        infoMap.set(item.assignmentId, {
                            title: pm.name
                                ? `${pm.name}${pm.honorific || ''}`
                                : pm.title,
                            customer: pm.customerName || undefined,
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

    // projects が非同期で到着した後、新規日報かつ workItems が空なら todayAssignments から再生成
    useEffect(() => {
        if (!isOpen) return;
        if (selectedReport) return; // 既存日報を編集中は触らない
        if (workItems.length > 0) return; // 既に入力がある場合は上書きしない
        if (todayAssignments.length === 0) return;
        setWorkItems(todayAssignments.map(a => ({
            assignmentId: a.id,
            startTime: '08:00',
            endTime: '17:00',
            breakMinutes: 0,
            workerIds: a.confirmedWorkerIds || [],
        })));
    }, [isOpen, selectedReport, projects, effectiveForemanId, dateStr]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // 画像選択
    const handleImagesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;
        setImageFiles(prev => [...prev, ...files]);
        const newPreviews = files.map(f => URL.createObjectURL(f));
        setImagePreviews(prev => [...prev, ...newPreviews]);
        // 同じファイルを再選択できるようにinputをリセット
        e.target.value = '';
    };

    const removeImage = (index: number) => {
        setImageFiles(prev => prev.filter((_, i) => i !== index));
        setImagePreviews(prev => {
            const toRevoke = prev[index];
            if (toRevoke) URL.revokeObjectURL(toRevoke);
            return prev.filter((_, i) => i !== index);
        });
    };

    // commentPromptが閉じた時にプレビューURLを解放
    useEffect(() => {
        if (!commentPrompt) {
            imagePreviews.forEach(url => URL.revokeObjectURL(url));
            setImageFiles([]);
            setImagePreviews([]);
        }
    }, [commentPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

    // 1画像をクライアント側で圧縮（3MB以上の場合のみ）してVercelの4.5MB上限を回避
    const compressIfNeeded = async (file: File): Promise<File | Blob> => {
        if (!file.type.startsWith('image/') || file.size <= 3 * 1024 * 1024) return file;
        try {
            const blob = await imageCompression(file, {
                maxSizeMB: 3,
                maxWidthOrHeight: 3000,
                useWebWorker: true,
                initialQuality: 0.9,
            });
            return blob;
        } catch (e) {
            logger.error('Client-side image compression failed', e, { fileName: file.name });
            return file;
        }
    };

    // 案件登録と同じ方式で /api/project-masters/{id}/files へ並列アップロード
    const uploadImagesSeparately = async (
        projectMasterId: string,
        category: ImageCategory,
        files: File[]
    ): Promise<{ uploadedCount: number; failedCount: number; firstError?: string }> => {
        if (!projectMasterId) return { uploadedCount: 0, failedCount: files.length, firstError: 'projectMasterId is missing' };
        const results = await Promise.all(
            files.map(async (file): Promise<{ ok: boolean; error?: string }> => {
                try {
                    const compressed = await compressIfNeeded(file);
                    const fd = new FormData();
                    fd.append('file', compressed, file.name);
                    fd.append('category', category);
                    const res = await fetch(`/api/project-masters/${projectMasterId}/files`, {
                        method: 'POST',
                        body: fd,
                    });
                    if (res.ok) return { ok: true };
                    const data = await res.json().catch(() => ({}));
                    const msg = data?.error || `status ${res.status}`;
                    logger.error('Image upload failed', msg, { fileName: file.name, mimeType: file.type, size: file.size });
                    return { ok: false, error: msg };
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    logger.error('Image upload threw', e, { fileName: file.name });
                    return { ok: false, error: msg };
                }
            })
        );
        const uploadedCount = results.filter(r => r.ok).length;
        const firstError = results.find(r => !r.ok)?.error;
        return { uploadedCount, failedCount: results.length - uploadedCount, firstError };
    };

    // 作業開始/終了ボタン
    const handleWorkStatus = async (
        assignmentId: string,
        projectMasterId: string,
        type: 'start' | 'end',
        comment?: string,
        images?: { category: ImageCategory; files: File[] }
    ) => {
        const key = `${assignmentId}:${type}`;
        setWorkStatusBusy((prev) => ({ ...prev, [key]: true }));
        try {
            // 1. 画像があれば先に並列アップロード（案件登録と同じ /api/project-masters/{id}/files を利用）
            let uploadedImageCount = 0;
            let uploadFailedCount = 0;
            let uploadFirstError: string | undefined;
            let imageCategoryForBody: ImageCategory | null = null;
            if (images && images.files.length > 0 && projectMasterId) {
                const result = await uploadImagesSeparately(projectMasterId, images.category, images.files);
                uploadedImageCount = result.uploadedCount;
                uploadFailedCount = result.failedCount;
                uploadFirstError = result.firstError;
                imageCategoryForBody = images.category;
            }

            // 2. work-statusはJSONで件数だけ渡す
            const res = await fetch(`/api/assignments/${assignmentId}/work-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    comment: comment || undefined,
                    uploadedImageCount: uploadedImageCount || undefined,
                    imageCategory: imageCategoryForBody || undefined,
                }),
            });

            if (res.status === 409) {
                const data = await res.json().catch(() => ({}));
                setSaveMessage({ type: 'error', text: data?.error || '既に通知済みです' });
                return;
            }
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setSaveMessage({ type: 'error', text: data?.error || '通知の送信に失敗しました' });
                return;
            }

            const data = await res.json();
            const timeStr: string = data?.time || '';

            // 日報側のstartTime/endTime表示も更新
            setWorkItems((prev) => {
                const exists = prev.find((w) => w.assignmentId === assignmentId);
                if (exists) {
                    return prev.map((w) =>
                        w.assignmentId === assignmentId
                            ? { ...w, [type === 'start' ? 'startTime' : 'endTime']: timeStr }
                            : w
                    );
                }
                return [
                    ...prev,
                    {
                        assignmentId,
                        startTime: type === 'start' ? timeStr : '08:00',
                        endTime: type === 'end' ? timeStr : '17:00',
                        breakMinutes: 0,
                        workerIds: [],
                    },
                ];
            });

            // ストア側のassignmentを更新（ボタンの無効化反映のため）
            const a = data?.assignment;
            if (a) {
                upsertAssignmentStore({
                    ...a,
                    date: new Date(a.date),
                    createdAt: new Date(a.createdAt),
                    updatedAt: new Date(a.updatedAt),
                    workStartedAt: a.workStartedAt ? new Date(a.workStartedAt) : null,
                    workEndedAt: a.workEndedAt ? new Date(a.workEndedAt) : null,
                    projectMaster: a.projectMaster
                        ? {
                            ...a.projectMaster,
                            createdAt: new Date(a.projectMaster.createdAt),
                            updatedAt: new Date(a.projectMaster.updatedAt),
                        }
                        : undefined,
                });
            }

            const categoryLabelMap: Record<ImageCategory, string> = { assembly: '組立', demolition: '解体', other: 'その他' };
            const imageSuffix = uploadedImageCount > 0 && imageCategoryForBody
                ? `・${categoryLabelMap[imageCategoryForBody]}に${uploadedImageCount}枚保存`
                : '';
            const failSuffix = uploadFailedCount > 0
                ? `（${uploadFailedCount}枚の画像アップロードに失敗${uploadFirstError ? `: ${uploadFirstError}` : ''}）`
                : '';
            setSaveMessage({
                type: uploadFailedCount > 0 ? 'error' : 'success',
                text: (type === 'start'
                    ? `作業開始を通知しました（${timeStr}）${imageSuffix}`
                    : `作業完了を通知しました（${timeStr}）${imageSuffix}`) + failSuffix,
            });
        } catch (error) {
            logger.error('Failed to send work status:', error);
            setSaveMessage({ type: 'error', text: '通知の送信に失敗しました' });
        } finally {
            setWorkStatusBusy((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
        }
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
            logger.error('Failed to save:', error);
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
        <>
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            {/* オーバーレイ（PCのみ） */}
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            {/* モーダル本体 */}
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-2xl lg:mx-4 lg:max-h-[90vh]">
                {/* Header */}
                <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <div>
                        <h2 className="text-xl font-semibold text-slate-800">
                            {selectedReport && !isEditMode ? '報告詳細' : '報告入力'}
                        </h2>
                        {selectedReport && <LastUpdatedLabel updatedAt={selectedReport.updatedAt} updatedBy={selectedReport.updatedBy} />}
                    </div>
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
                            canModify={
                                isAdminOrManager ||
                                selectedReport.foremanId === session?.user?.id
                            }
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
                                            const displayItems: { id: string; projectMasterId: string; title: string; customer?: string; workStartedAt?: Date | null; workEndedAt?: Date | null }[] = [
                                                ...todayAssignments.map(a => ({ id: a.id, projectMasterId: a.projectMasterId, title: a.title, customer: a.customer, workStartedAt: a.workStartedAt ?? null, workEndedAt: a.workEndedAt ?? null })),
                                            ];
                                            // 既存workItemsにあるがtodayAssignmentsにないassignmentを追加
                                            for (const wi of workItems) {
                                                if (!assignmentIds.has(wi.assignmentId)) {
                                                    const info = existingWorkItemInfoMap.get(wi.assignmentId);
                                                    const p = projects.find(pp => pp.id === wi.assignmentId);
                                                    displayItems.push({
                                                        id: wi.assignmentId,
                                                        projectMasterId: p?.projectMasterId || '',
                                                        title: info?.title || '(案件名不明)',
                                                        customer: info?.customer,
                                                        workStartedAt: p?.workStartedAt ?? null,
                                                        workEndedAt: p?.workEndedAt ?? null,
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

                                                        const startBusy = !!workStatusBusy[`${assignment.id}:start`];
                                                        const endBusy = !!workStatusBusy[`${assignment.id}:end`];

                                                        return (
                                                            <div key={assignment.id} className="p-3 bg-slate-50 rounded-lg">
                                                                <div className="mb-2 flex items-start justify-between gap-2 flex-wrap">
                                                                    <div className="min-w-0">
                                                                        <div className="font-medium text-slate-800">{assignment.title}</div>
                                                                        {assignment.customer && (
                                                                            <div className="text-sm text-slate-500">{assignment.customer}</div>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-2 shrink-0">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setCommentText('');
                                                                                setImageCategory(null);
                                                                                setCommentPrompt({ assignmentId: assignment.id, projectMasterId: assignment.projectMasterId, type: 'start', title: assignment.title });
                                                                            }}
                                                                            disabled={startBusy}
                                                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                                                                            title="作業開始を通知"
                                                                        >
                                                                            {startBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                                                            開始
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setCommentText('');
                                                                                setImageCategory(null);
                                                                                setCommentPrompt({ assignmentId: assignment.id, projectMasterId: assignment.projectMasterId, type: 'end', title: assignment.title });
                                                                            }}
                                                                            disabled={endBusy}
                                                                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                                                                            title="作業完了を通知"
                                                                        >
                                                                            {endBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                                                                            完了
                                                                        </button>
                                                                    </div>
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
                                                                                            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-300'
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
                    <div className="flex-shrink-0 flex justify-end gap-3 px-6 pt-4 pb-6 border-t border-slate-200 bg-slate-50">
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

        {/* 開始/完了通知の一言メモ入力モーダル */}
        {commentPrompt && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
                        <h3 className="text-base font-semibold text-slate-800">
                            {commentPrompt.type === 'start' ? '作業開始を通知' : '作業完了を通知'}
                        </h3>
                        <button
                            type="button"
                            onClick={() => setCommentPrompt(null)}
                            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-slate-500" />
                        </button>
                    </div>
                    <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
                        <div className="text-sm text-slate-600 truncate">{commentPrompt.title}</div>
                        <div>
                            <label className="block text-sm text-slate-700 mb-1">
                                一言メモ（任意・100文字まで）
                            </label>
                            <textarea
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value.slice(0, 100))}
                                rows={3}
                                maxLength={100}
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                placeholder="例: 資材遅れのため30分押しで開始"
                            />
                            <div className="mt-1 text-xs text-slate-400 text-right">
                                {commentText.length}/100
                            </div>
                        </div>
                        {/* 画像アップロード（完了時のみ） */}
                        {commentPrompt.type === 'end' && (
                            <div className="pt-2 border-t border-slate-200">
                                <label className="block text-sm text-slate-700 mb-2">
                                    画像（任意・案件フォルダに保存されます）
                                </label>
                                <div className="flex gap-2 mb-2">
                                    {(['assembly', 'demolition', 'other'] as const).map(cat => {
                                        const label = cat === 'assembly' ? '組立' : cat === 'demolition' ? '解体' : 'その他';
                                        const active = imageCategory === cat;
                                        return (
                                            <button
                                                key={cat}
                                                type="button"
                                                onClick={() => setImageCategory(cat)}
                                                className={`flex-1 px-3 py-2 text-sm rounded-xl border transition-colors ${
                                                    active
                                                        ? 'bg-slate-800 text-white border-slate-800'
                                                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <label className="flex items-center justify-center gap-2 px-3 py-2.5 border border-dashed border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors">
                                    <ImagePlus className="w-4 h-4" />
                                    画像を選択（複数可）
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleImagesSelected}
                                        className="hidden"
                                    />
                                </label>
                                {imageFiles.length > 0 && !imageCategory && (
                                    <div className="mt-2 text-xs text-red-500">
                                        画像を保存するカテゴリ（組立/解体/その他）を選択してください
                                    </div>
                                )}
                                {imagePreviews.length > 0 && (
                                    <div className="grid grid-cols-3 gap-2 mt-3">
                                        {imagePreviews.map((src, idx) => (
                                            <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={src} alt={`preview-${idx}`} className="w-full h-full object-cover" />
                                                <button
                                                    type="button"
                                                    onClick={() => removeImage(idx)}
                                                    className="absolute top-1 right-1 p-1 bg-white/90 rounded-full hover:bg-white transition-colors shadow-sm"
                                                    title="削除"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5 text-slate-700" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {imageFiles.length > 0 && (
                                    <div className="mt-2 text-xs text-slate-500">
                                        {imageFiles.length}枚選択中
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                        <button
                            type="button"
                            onClick={() => setCommentPrompt(null)}
                            className="px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
                        >
                            キャンセル
                        </button>
                        <button
                            type="button"
                            disabled={commentPrompt.type === 'end' && imageFiles.length > 0 && !imageCategory}
                            onClick={() => {
                                const p = commentPrompt;
                                const imagesPayload = (p.type === 'end' && imageFiles.length > 0 && imageCategory)
                                    ? { category: imageCategory, files: imageFiles }
                                    : undefined;
                                setCommentPrompt(null);
                                handleWorkStatus(p.assignmentId, p.projectMasterId, p.type, commentText.trim() || undefined, imagesPayload);
                            }}
                            className={`flex items-center gap-1 px-4 py-2 rounded-xl text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                commentPrompt.type === 'start'
                                    ? 'bg-emerald-600 hover:bg-emerald-700'
                                    : 'bg-slate-700 hover:bg-slate-800'
                            }`}
                        >
                            {commentPrompt.type === 'start' ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            {commentPrompt.type === 'end' && imageFiles.length > 0 ? `通知を送信（画像${imageFiles.length}枚）` : '通知を送信'}
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
