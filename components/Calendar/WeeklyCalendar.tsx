'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useNavigation } from '@/contexts/NavigationContext';
import { useCalendar } from '@/hooks/useCalendar';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import type { PendingMove } from '@/hooks/useDragAndDrop';
import type { Vehicle } from '@/types/master';
import { useCalendarModals } from '@/hooks/useCalendarModals';
import { useProjects, ConflictUpdateError } from '@/hooks/useProjects';
import { useMasterData } from '@/hooks/useMasterData';
import { useVacation } from '@/hooks/useVacation';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useCalendarStore } from '@/stores/calendarStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { generateEmployeeRows, formatDateKey } from '@/utils/employeeUtils';
import { canDispatch as canDispatchCheck, isManagerOrAbove } from '@/utils/permissions';
import { addDays, formatDate } from '@/utils/dateUtils';
import { CalendarEvent, CalendarNavigation, Project, Employee, ProjectAssignment, ConflictResolutionAction } from '@/types/calendar';
import Loading from '@/components/ui/Loading';
import Button from '@/components/ui/Button';
import { useAssignmentPresence } from '@/hooks/useAssignmentPresence';
import DesktopCalendarView from './DesktopCalendarView';
import MobileCalendarView from './MobileCalendarView';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';
import { showUndoToast } from './undoToast';

// モーダルを遅延読み込み
const ProjectModal = dynamic(() => import('../Projects/ProjectModal'), {
    loading: () => <Loading overlay />
});
const ProjectMasterSearchModal = dynamic(() => import('../ProjectMasterSearchModal'), {
    loading: () => <Loading overlay />
});
const DispatchConfirmModal = dynamic(() => import('./DispatchConfirmModal'), {
    loading: () => <Loading overlay />
});
const CopyAssignmentModal = dynamic(() => import('./CopyAssignmentModal'), {
    loading: () => <Loading overlay />
});
const ProjectSelectionModal = dynamic(() => import('./ProjectSelectionModal'), {
    loading: () => <Loading overlay />
});
const ScheduleSearchPanel = dynamic(() => import('./ScheduleSearchPanel'), {
    loading: () => <Loading overlay />
});
const ConflictResolutionModal = dynamic(() => import('./ConflictResolutionModal'));
const MoveConfirmModal = dynamic(() => import('./MoveConfirmModal'), {
    loading: () => <Loading overlay />
});
const FloatingPromoteModal = dynamic(() => import('./FloatingPromoteModal'), {
    loading: () => <Loading overlay />
});

interface WeeklyCalendarProps {
    partnerMode?: boolean;
    partnerId?: string;
    onNavigationReady?: (nav: CalendarNavigation) => void;
    onSearchReady?: (openSearch: () => void) => void;
    /**
     * 外部（チャットの「予定」など）からの特定日ジャンプ依頼。
     * nonce は使い捨て番号で、同じ日付を続けて要求されても再ジャンプできるようにするためのもの。
     */
    jumpRequest?: { date: string; assignmentId: string | null; nonce: number } | null;
    onJumpConsumed?: () => void;
}

export default function WeeklyCalendar({ partnerMode = false, partnerId, onNavigationReady, onSearchReady, jumpRequest, onJumpConsumed }: WeeklyCalendarProps) {
    const { data: session, status } = useSession();
    const { projects, addProject, updateProject, updateProjects, demoteToFloating, deleteProject, restoreAssignment, restoreDeletedAssignment, fetchForDateRange, isInitialized, refreshProjects, forceRefreshRange } = useProjects();
    const { getTotalMembersForDate } = useMasterData();
    const { getVacationEmployees } = useVacation();
    const { displayedForemanIds, removeForeman, allForemen, moveForeman, floatingLaneIndex, moveFloatingLane, isLoading: isCalendarLoading } = useCalendarDisplay();
    const [isMounted, setIsMounted] = useState(false);
    const userRole = session?.user?.role;
    const isForeman2 = userRole === 'foreman2';
    const isReadOnly = partnerMode || isForeman2;
    // Tailwindの`lg`と同条件で「デスクトップではない」= モバイルレイアウト判定
    // （iPad横向きはアスペクト比が16:10未満なのでモバイル扱いになる）
    const isMobile = useMediaQuery('not all and (min-width: 1024px) and (min-aspect-ratio: 16/10)');

    // Presence機能: 編集中ユーザーの追跡
    const { getEditingUsers } = useAssignmentPresence();

    // 保存中の状態管理
    const [isSaving, setIsSaving] = useState(false);

    // 競合解決モーダル用の状態
    const [conflictModalOpen, setConflictModalOpen] = useState(false);
    const [conflictData, setConflictData] = useState<{
        latestData?: ProjectAssignment;
        message: string;
        pendingUpdate?: { id: string; updates: Partial<Project> };
    } | null>(null);

    // 案件をカレンダーイベントに展開 (projectsが変わると再計算)
    const events: CalendarEvent[] = useMemo(() => projects as CalendarEvent[], [projects]);

    // モーダル関連のロジックをカスタムフックに分離
    const {
        isModalOpen, modalInitialData, handleEventClick, handleCloseModal, setModalInitialData, setIsModalOpen,
        isSearchModalOpen, cellContext, handleSelectProjectMaster, handleCloseSearchModal,
        isSelectionModalOpen, handleCellClick, handleSelectExisting, handleCreateNew, handleSelectionCancel,
        isDispatchModalOpen, dispatchProject, handleOpenDispatchModal, handleCloseDispatchModal,
        isCopyModalOpen, copyEvent, handleCopyEvent, handleCloseCopyModal, handleCopyAssignment,
    } = useCalendarModals(projects, events, addProject);

    // 手配確定権限チェック
    const canDispatch = useMemo(() => canDispatchCheck(session?.user), [session?.user]);

    // 案件マスタ編集画面への遷移（管理者・マネージャーのみ導線を表示）
    const router = useRouter();
    const { setActivePage } = useNavigation();
    const canEditProjectMaster = useMemo(() => isManagerOrAbove(session?.user), [session?.user]);

    // 浮き（班未定）の見せ方: kei指示（2026-07-21）で管理者・マネージャー限定。
    // レーン本体・日付ヘッダーの赤バッジ・「浮きに戻す」導線をまとめてこれで制御する
    const canSeeFloatingLane = useMemo(() => !partnerMode && isManagerOrAbove(session?.user), [partnerMode, session?.user]);
    const handleEditProjectMaster = useCallback(() => {
        const pmId = modalInitialData.projectMasterId;
        if (!pmId) return;
        handleCloseModal();
        // 二段構え: setActivePage を直接呼びつつ router.push でディープリンク
        // （スケジュール画面では router.push 単独だと MainContent の useEffect が
        // 発火しないことがあるため。既存の通知遷移と同じパターン）
        setActivePage('project-masters');
        router.push(`/?page=project-masters&pmId=${pmId}&pmEdit=1`);
    }, [modalInitialData.projectMasterId, handleCloseModal, setActivePage, router]);

    // ── 浮き（班未定の配置）関連 ──
    const [promoteEvent, setPromoteEvent] = useState<CalendarEvent | null>(null);

    // 浮きカードのタップ → 昇格モーダル（班別の埋まり具合を見て班を選ぶ）
    const handleFloatingEventClick = useCallback((eventId: string) => {
        const event = (projects as CalendarEvent[]).find(e => e.id === eventId);
        if (event) setPromoteEvent(event);
    }, [projects]);

    // 浮きレーンの空きセルタップ → 既存の登録動線（選択モーダル）に 'unassigned' 文脈で乗せる。
    // 保存はストアが正門 POST /api/assignments/floating へ振り替える
    const handleFloatingCellClick = useCallback((date: Date) => {
        handleCellClick('unassigned', date);
    }, [handleCellClick]);

    // 昇格: 班を選んで既存PATCH（履歴記録と職長への通知は既存実装が自動で乗る）
    const handlePromoteFloating = useCallback(async (eventId: string, foremanId: string) => {
        try {
            await updateProject(eventId, { assignedEmployeeId: foremanId });
            toast.success('班に割り当てました');
        } catch (e) {
            if (e instanceof ConflictUpdateError) {
                toast.error('他のユーザーが更新しています。開き直して確認してください');
            } else {
                toast.error('割り当てに失敗しました');
            }
            throw e;
        }
    }, [updateProject]);

    // 降格: 配置を浮きに戻す（編集モーダルの「浮きに戻す」・浮きレーンへのドロップ/移動から。正門経由）。
    // date を渡すと降格と同時に別日へ移動する（別日の浮きセルへ落とした場合）。
    const handleDemoteToFloating = useCallback(async (eventId: string, date?: Date) => {
        try {
            await demoteToFloating(eventId, date);
            toast.success('浮きに戻しました');
            handleCloseModal();
        } catch (e) {
            if (e instanceof ConflictUpdateError) {
                toast.error('他のユーザーが更新しています。開き直して確認してください');
            } else {
                toast.error('浮きへの変更に失敗しました');
            }
        }
    }, [demoteToFloating, handleCloseModal]);

useEffect(() => { setIsMounted(true); }, []);

    // 競合解決ハンドラー
    const handleConflictResolution = useCallback(async (action: ConflictResolutionAction) => {
        if (!conflictData) return;

        switch (action) {
            case 'reload':
                await refreshProjects();
                break;
            case 'overwrite':
                if (conflictData.pendingUpdate) {
                    try {
                        const response = await fetch(`/api/assignments/${conflictData.pendingUpdate.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                assignedEmployeeId: conflictData.pendingUpdate.updates.assignedEmployeeId,
                                date: conflictData.pendingUpdate.updates.startDate instanceof Date
                                    ? conflictData.pendingUpdate.updates.startDate.toISOString()
                                    : conflictData.pendingUpdate.updates.startDate,
                                sortOrder: conflictData.pendingUpdate.updates.sortOrder,
                                workers: conflictData.pendingUpdate.updates.workers,
                                vehicles: conflictData.pendingUpdate.updates.vehicles,
                                meetingTime: conflictData.pendingUpdate.updates.meetingTime,
                                remarks: conflictData.pendingUpdate.updates.remarks,
                            }),
                        });
                        if (response.ok) {
                            await refreshProjects();
                        }
                    } catch (err) {
                        logger.error('Failed to overwrite:', err);
                    }
                }
                break;
            case 'cancel':
                break;
        }

        setConflictModalOpen(false);
        setConflictData(null);
    }, [conflictData, refreshProjects]);

    // 競合を処理するupdateProject wrapper
    const updateProjectWithConflictHandling = useCallback(async (id: string, updates: Partial<Project>) => {
        try {
            await updateProject(id, updates);
        } catch (error) {
            if (error instanceof ConflictUpdateError) {
                setConflictData({
                    latestData: error.latestData,
                    message: error.message,
                    pendingUpdate: { id, updates },
                });
                setConflictModalOpen(true);
            } else {
                throw error;
            }
        }
    }, [updateProject]);

    // 移動確認モーダル用の状態
    const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
    const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
    const [availableVehiclesData, setAvailableVehiclesData] = useState<{
        available: Vehicle[];
        inUse: { id: string; name: string; usedBy: string }[];
    } | null>(null);

    // セル間移動が発生したら即時確定せず、確認モーダルを開いて空き車両を取得
    const handlePendingMove = useCallback(async (pending: PendingMove) => {
        // 浮きレーンへのドロップ/移動 = 降格。車両引き継ぎの判断は不要（手配確定は自動クリア）
        // なので確認モーダルは開かず即実行する
        if (pending.toEmployeeId === 'unassigned') {
            const projectId = pending.eventId.replace(/-assembly$|-demolition$/, '');
            const sameDay = formatDateKey(pending.fromDate) === formatDateKey(pending.toDate);
            // 浮き → 浮きの移動：班は浮きのまま日付だけ動かす。
            // assignedEmployeeId は送らない（正門PATCHは 'unassigned' 指定を弾くため、通常の
            // startDate＋sortOrder 更新だけで完結する）。
            if (pending.fromEmployeeId === 'unassigned') {
                if (sameDay) return; // 変化なし
                const newDateKey = formatDateKey(pending.toDate);
                // 移動先の浮きレーン末尾に並ぶ sortOrder を採番（applyPendingMove と同じ流儀）
                const newSortOrder = projectsRef.current
                    .filter((p) => p.id !== projectId && p.assignedEmployeeId === 'unassigned' && formatDateKey(p.startDate) === newDateKey)
                    .reduce((max, p) => Math.max(max, p.sortOrder ?? 0), -1) + 1;
                updateProjectWithConflictHandling(projectId, { startDate: pending.toDate, sortOrder: newSortOrder });
                return;
            }
            // 職長 → 浮き（降格）。別日なら日付移動も同時に（正門経由・手配確定は自動クリア）
            handleDemoteToFloating(projectId, sameDay ? undefined : pending.toDate);
            return;
        }
        setPendingMove(pending);
        setAvailableVehiclesData(null);
        setIsMoveModalOpen(true);
        try {
            const dateKey = formatDateKey(pending.toDate);
            const projectId = pending.eventId.replace(/-assembly$|-demolition$/, '');
            const res = await fetch(
                `/api/calendar/available-vehicles?date=${dateKey}&excludeAssignmentId=${projectId}`,
                { cache: 'no-store' }
            );
            if (res.ok) {
                setAvailableVehiclesData(await res.json());
            } else {
                setAvailableVehiclesData({ available: [], inUse: [] });
            }
        } catch (e) {
            logger.error('Failed to fetch available vehicles:', e);
            setAvailableVehiclesData({ available: [], inUse: [] });
        }
    }, [handleDemoteToFloating, updateProjectWithConflictHandling]);

    const { currentDate, weekDays, goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday, goToDate } = useCalendar(events);

    // 協力会社モード: 閲覧できる範囲を「3ヶ月前〜4週先」に制限する（kei指示 2026-07-22/2026-08-17）。
    // 表示開始日が今週の月曜から何日先か(−91〜28日)で判定する。日送りは表示窓を1日ずらす機能
    // なので、週送り(±7日)・日送り(±1日)それぞれ移動後も範囲内に収まるときだけ許可する。
    const PARTNER_MAX_DAY_OFFSET = 28; // 4週先の月曜まで(その週の日曜まで表示される)
    const PARTNER_MIN_DAY_OFFSET = -91; // 13週(約3ヶ月)前の月曜まで遡れる
    const partnerFirstMonday = useMemo(() => {
        if (!partnerMode) return null;
        const now = new Date();
        const day = now.getDay();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day === 0 ? -6 : 1 - day)).getTime();
    }, [partnerMode]);
    const partnerDayOffset = partnerFirstMonday === null
        ? 0
        : Math.round((new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime() - partnerFirstMonday) / 86400000);
    const canGoPrevWeek = partnerFirstMonday === null || partnerDayOffset - 7 >= PARTNER_MIN_DAY_OFFSET;
    const canGoNextWeek = partnerFirstMonday === null || partnerDayOffset + 7 <= PARTNER_MAX_DAY_OFFSET;
    const canGoPrevDay = partnerFirstMonday === null || partnerDayOffset - 1 >= PARTNER_MIN_DAY_OFFSET;
    const canGoNextDay = partnerFirstMonday === null || partnerDayOffset + 1 <= PARTNER_MAX_DAY_OFFSET;
    // 非協力会社モードでは素の関数をそのまま渡す（既存挙動を変えない）
    const navGoToPreviousWeek = partnerMode ? () => { if (canGoPrevWeek) goToPreviousWeek(); } : goToPreviousWeek;
    const navGoToNextWeek = partnerMode ? () => { if (canGoNextWeek) goToNextWeek(); } : goToNextWeek;
    const navGoToPreviousDay = partnerMode ? () => { if (canGoPrevDay) goToPreviousDay(); } : goToPreviousDay;
    const navGoToNextDay = partnerMode ? () => { if (canGoNextDay) goToNextDay(); } : goToNextDay;
    // 協力会社モードのPC用: DesktopCalendarView 内蔵ナビバーに渡す週ラベル
    const weekLabel = useMemo(() => weekDays.length > 0
        ? `${formatDate(weekDays[0].date, 'short')}〜${formatDate(weekDays[weekDays.length - 1].date, 'short')}`
        : '', [weekDays]);

    // 検索パネルの開閉
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const handleOpenSearch = useCallback(() => setIsSearchOpen(true), []);
    const handleCloseSearch = useCallback(() => setIsSearchOpen(false), []);

    // 検索結果クリック時のハイライト（3秒間）
    const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
    const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        return () => {
            if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        };
    }, []);
    // 同じ配置へ続けてジャンプしたとき（ハイライト中に再度押された等）も必ずスクロールし直すための番号
    const [scrollRequest, setScrollRequest] = useState(0);
    const handleSearchJump = useCallback((date: Date, assignmentId: string) => {
        goToDate(date);
        setHighlightedEventId(assignmentId);
        setScrollRequest((n) => n + 1);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightedEventId(null), 4000);
    }, [goToDate]);

    // ハイライト対象が画面に入っていなければ自動スクロール
    // - ジャンプ後にprojectsが揃うまで何回かリトライ（最大1.5秒）
    useEffect(() => {
        if (!highlightedEventId) return;
        let cancelled = false;
        let attempts = 0;
        const maxAttempts = 8; // 200ms * 8 = 1.6秒
        const tryScroll = () => {
            if (cancelled) return;
            const el = document.querySelector<HTMLElement>(`[data-project-id="${highlightedEventId}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                return;
            }
            if (++attempts < maxAttempts) {
                setTimeout(tryScroll, 200);
            }
        };
        // 初回は次のpaintを待ってから
        const t = setTimeout(tryScroll, 100);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [highlightedEventId, projects, scrollRequest]);

    // 外部からのジャンプ依頼を消化（検索パネルからのジャンプと同じ handleSearchJump を再利用）。
    // nonce を ref で覚えて同じ依頼を二重に消化しないようにする
    const consumedJumpNonceRef = useRef<number | null>(null);
    useEffect(() => {
        if (!jumpRequest || !isMounted) return;
        if (consumedJumpNonceRef.current === jumpRequest.nonce) return;
        consumedJumpNonceRef.current = jumpRequest.nonce;
        const [y, m, d] = jumpRequest.date.split('-').map(Number);
        if (!y || !m || !d) return;
        const target = new Date(y, m - 1, d);
        if (jumpRequest.assignmentId) {
            handleSearchJump(target, jumpRequest.assignmentId);
        } else {
            goToDate(target);
        }
        onJumpConsumed?.();
    }, [jumpRequest, isMounted, handleSearchJump, goToDate, onJumpConsumed]);

    // ナビゲーション関数を親に公開
    useEffect(() => {
        if (onNavigationReady) {
            onNavigationReady({ goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday });
        }
    }, [onNavigationReady, goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday]);

    // 検索オープナーを親に公開（ScheduleToolbar から呼ばれる）
    useEffect(() => {
        if (onSearchReady) {
            onSearchReady(handleOpenSearch);
        }
    }, [onSearchReady, handleOpenSearch]);

    // 表示週の前後1週間のデータをフェッチ（デバウンス付き：週連打時に中間週のフェッチをスキップ）
    const fetchTimerRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (status === 'authenticated' && isMounted) {
            if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
            fetchTimerRef.current = setTimeout(() => {
                const weekStart = new Date(currentDate);
                const weekEnd = addDays(weekStart, 6);
                const rangeStart = addDays(weekStart, -7);
                const rangeEnd = addDays(weekEnd, 7);
                fetchForDateRange(rangeStart, rangeEnd);
            }, 300);
        }
        return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
    }, [currentDate, status, isMounted, fetchForDateRange]);

    // ポーリング: 120秒ごとに最新データを再取得（Supabase Realtime broadcast の補完）
    // - タブがバックグラウンドのときはスキップ（バッテリー節約）
    // - タブに戻ったら即時再取得
    // currentDateをrefで参照し、インターバルの再作成を防ぐ
    const currentDateRef = useRef(currentDate);
    currentDateRef.current = currentDate;
    useEffect(() => {
        if (status !== 'authenticated' || !isMounted) return;
        const refresh = () => {
            const weekStart = new Date(currentDateRef.current);
            const weekEnd = addDays(weekStart, 6);
            const rangeStart = addDays(weekStart, -7);
            const rangeEnd = addDays(weekEnd, 7);
            forceRefreshRange(rangeStart, rangeEnd);
        };
        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') refresh();
        }, 120_000);
        const onVisible = () => {
            if (document.visibilityState === 'visible') refresh();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [status, isMounted, forceRefreshRange]);

    // projectsの参照をrefで保持（クロージャの古い値問題を回避）
    const projectsRef = useRef(projects);
    projectsRef.current = projects;

    const { activeId, handleDragStart, handleDragEnd, handleDragOver, handleDragCancel } = useDragAndDrop(events, useCallback((updatedEvents: CalendarEvent[]) => {
        updatedEvents.forEach(updatedEvent => {
            const projectId = updatedEvent.id.replace(/-assembly$|-demolition$/, '');
            const currentProjects = projectsRef.current;
            const originalProject = currentProjects.find((p: Project) => p.id === projectId);
            if (originalProject) {
                const hasChanges =
                    originalProject.assignedEmployeeId !== updatedEvent.assignedEmployeeId ||
                    originalProject.startDate.getTime() !== updatedEvent.startDate.getTime() ||
                    originalProject.sortOrder !== updatedEvent.sortOrder;

                if (hasChanges) {
                    const updates: Partial<Project> = {
                        assignedEmployeeId: updatedEvent.assignedEmployeeId,
                        sortOrder: updatedEvent.sortOrder,
                    };

                    if (updatedEvent.id.endsWith('-assembly')) {
                        updates.assemblyStartDate = updatedEvent.startDate;
                        updates.startDate = updatedEvent.startDate;
                    } else if (updatedEvent.id.endsWith('-demolition')) {
                        updates.demolitionStartDate = updatedEvent.startDate;
                        updates.startDate = updatedEvent.startDate;
                    } else {
                        updates.startDate = updatedEvent.startDate;
                    }

                    updateProjectWithConflictHandling(projectId, updates);
                }
            }
        });
    }, [updateProjectWithConflictHandling]), { onPendingMove: handlePendingMove });

    // 移動を確定（職長/日付/並び順 ＋ 任意で車両・人数）。既存の競合ハンドリングを通す
    const applyPendingMove = useCallback((
        pending: PendingMove,
        extra?: { trucks?: string[]; memberCount?: number }
    ) => {
        const projectId = pending.eventId.replace(/-assembly$|-demolition$/, '');
        const newDateKey = formatDateKey(pending.toDate);
        const targetCellEvents = projectsRef.current.filter((p: Project) =>
            p.id !== projectId &&
            p.assignedEmployeeId === pending.toEmployeeId &&
            formatDateKey(p.startDate) === newDateKey
        );
        const newSortOrder = targetCellEvents.reduce(
            (max: number, p: Project) => Math.max(max, p.sortOrder ?? 0),
            -1
        ) + 1;

        const updates: Partial<Project> = {
            assignedEmployeeId: pending.toEmployeeId,
            sortOrder: newSortOrder,
        };
        if (pending.eventId.endsWith('-assembly')) {
            updates.assemblyStartDate = pending.toDate;
            updates.startDate = pending.toDate;
        } else if (pending.eventId.endsWith('-demolition')) {
            updates.demolitionStartDate = pending.toDate;
            updates.startDate = pending.toDate;
        } else {
            updates.startDate = pending.toDate;
        }
        if (extra?.trucks !== undefined) updates.vehicles = extra.trucks;
        if (extra?.memberCount !== undefined) updates.memberCount = extra.memberCount;

        updateProjectWithConflictHandling(projectId, updates);

        // 誤操作対策: 移動直後に「元に戻す」トーストを表示し、元のセル（職長・日付）へ戻せるようにする。
        // PendingMove が移動元（fromEmployeeId / fromDate）を保持しているのでそれを使う。
        const beforeEmployeeId = pending.fromEmployeeId;
        const beforeDate = pending.fromDate;
        const label = pending.title || '案件';
        showUndoToast({
            message: `${label} を移動しました`,
            onUndo: () => {
                const undoUpdates: Partial<Project> = { assignedEmployeeId: beforeEmployeeId };
                if (pending.eventId.endsWith('-assembly')) {
                    undoUpdates.assemblyStartDate = beforeDate;
                    undoUpdates.startDate = beforeDate;
                } else if (pending.eventId.endsWith('-demolition')) {
                    undoUpdates.demolitionStartDate = beforeDate;
                    undoUpdates.startDate = beforeDate;
                } else {
                    undoUpdates.startDate = beforeDate;
                }
                updateProjectWithConflictHandling(projectId, undoUpdates);
            },
        });
    }, [updateProjectWithConflictHandling, projectsRef]);

    const closeMoveModal = useCallback(() => {
        setIsMoveModalOpen(false);
        setPendingMove(null);
        setAvailableVehiclesData(null);
    }, []);

    const handleMoveKeep = useCallback(() => {
        if (pendingMove) applyPendingMove(pendingMove);
        closeMoveModal();
    }, [pendingMove, applyPendingMove, closeMoveModal]);

    const handleMoveReassign = useCallback((trucks: string[], memberCount: number) => {
        if (pendingMove) applyPendingMove(pendingMove, { trucks, memberCount });
        closeMoveModal();
    }, [pendingMove, applyPendingMove, closeMoveModal]);

    const handleMoveCancel = useCallback(() => {
        // 何も更新しない（カードは元の位置のまま）
        closeMoveModal();
    }, [closeMoveModal]);

    // 職長別の行データを生成
    const employeeRows = useMemo(() => {
        let filteredEmployees: Employee[] = [];

        if (partnerMode && partnerId) {
            const partnerData = allForemen.find(f => f.id === partnerId);
            if (partnerData) {
                filteredEmployees = [{ id: partnerData.id, name: partnerData.displayName }];
            }
        } else {
            filteredEmployees = displayedForemanIds
                .map(id => allForemen.find(f => f.id === id))
                .filter((foreman): foreman is typeof allForemen[0] => foreman !== undefined)
                .map(foreman => ({ id: foreman.id, name: foreman.displayName }));
        }

        return generateEmployeeRows(filteredEmployees, events, weekDays);
    }, [events, weekDays, displayedForemanIds, allForemen, partnerMode, partnerId]);

    // 浮きレーンをどの職長行の前に挟むか。null = 一番下（従来どおり）。
    // 保存値は「displayedForemanIdsの何番目の前か」だが、退職などで行にならないIDが
    // 混じることがあるため、そこから下方向へ実在する行を探してアンカーにする。
    const floatingLaneAnchorId = useMemo(() => {
        const start = floatingLaneIndex ?? displayedForemanIds.length;
        const rowIds = new Set(employeeRows.map((r) => r.employeeId));
        for (let i = Math.max(0, start); i < displayedForemanIds.length; i++) {
            if (rowIds.has(displayedForemanIds[i])) return displayedForemanIds[i];
        }
        return null;
    }, [floatingLaneIndex, displayedForemanIds, employeeRows]);

    // ▲▼の出し分け（端では隠す）
    const canMoveFloatingLaneUp = (floatingLaneIndex ?? displayedForemanIds.length) > 0;
    const canMoveFloatingLaneDown = (floatingLaneIndex ?? displayedForemanIds.length) < displayedForemanIds.length;

    const activeEvent = useMemo(() => activeId ? events.find(event => event.id === activeId) ?? null : null, [activeId, events]);

    // 矢印ボタンでイベントを上下に移動
    const handleMoveEvent = useCallback((eventId: string, direction: 'up' | 'down') => {
        const projectId = eventId.replace(/-assembly$|-demolition$/, '');
        const event = projects.find(p => p.id === projectId);
        if (!event) return;

        const cellEvents = projects.filter(p =>
            p.assignedEmployeeId === event.assignedEmployeeId &&
            formatDateKey(p.startDate) === formatDateKey(event.startDate)
        ).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        const currentIndex = cellEvents.findIndex(e => e.id === projectId);
        if (currentIndex === -1) return;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= cellEvents.length) return;

        const newOrder = [...cellEvents];
        [newOrder[currentIndex], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[currentIndex]];

        const updates = newOrder.map((evt, index) => ({ id: evt.id, data: { sortOrder: index } }));
        updateProjects(updates);
    }, [projects, updateProjects]);

    // モーダルから案件を保存（競合ハンドリング付き）
    const handleSaveProject = useCallback(async (projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        setIsSaving(true);
        try {
            if (modalInitialData.id) {
                await updateProjectWithConflictHandling(modalInitialData.id, projectData);
            } else {
                // 新規作成時: 対象セルの既存案件の最大sortOrder+1をセット（重複を防ぐ）
                if (!projectData.workSchedules?.length) {
                    const targetEmployeeId = projectData.assignedEmployeeId;
                    const targetDate = projectData.startDate instanceof Date ? projectData.startDate : new Date(projectData.startDate!);
                    if (targetEmployeeId && targetDate) {
                        const targetDateKey = formatDateKey(targetDate);
                        const targetCellProjects = projectsRef.current.filter(p =>
                            p.assignedEmployeeId === targetEmployeeId &&
                            formatDateKey(p.startDate) === targetDateKey
                        );
                        const maxSortOrder = targetCellProjects.reduce(
                            (max, p) => Math.max(max, p.sortOrder ?? 0),
                            -1
                        );
                        projectData = { ...projectData, sortOrder: maxSortOrder + 1 };
                    }
                }
                await addProject(projectData);
            }
        } finally {
            setIsSaving(false);
        }
    }, [modalInitialData.id, updateProjectWithConflictHandling, addProject]);

    // 長押しで別セルに移動（PC・スマホ・タブレット共通）
    // D&D と同じく即時保存せず、確認モーダル（MoveConfirmModal）を経由させる。
    // 週またぎ移動では移動元がフェッチ範囲外に出てストアから退避されるため、
    // events から ID 再検索すると見つからず無音で中断してしまう。
    // ビュー側が掴んでいる完全な CalendarEvent をそのまま受け取り、events 依存をなくす。
    const handleMoveToCell = useCallback((movingEvent: CalendarEvent, targetEmployeeId: string, targetDate: Date) => {
        if (!movingEvent) return;

        // 同セルガード: 移動元と同じ職長・同じ日付なら何もしない（モーダルを開かない）
        // 呼び出し側 commitMove が直後に setMovingEvent(null) するので移動モードは解除される
        if (
            (movingEvent.assignedEmployeeId ?? '') === targetEmployeeId &&
            formatDateKey(movingEvent.startDate) === formatDateKey(targetDate)
        ) {
            return;
        }

        handlePendingMove({
            eventId: movingEvent.id,
            fromEmployeeId: movingEvent.assignedEmployeeId ?? '',
            fromDate: movingEvent.startDate,
            toEmployeeId: targetEmployeeId,
            toDate: targetDate,
            currentTrucks: movingEvent.trucks ?? [],
            currentMemberCount: movingEvent.memberCount ?? 0,
            title: movingEvent.title,
        });
    }, [handlePendingMove]);

    // 誤操作対策: 削除直後に「元に戻す」トーストを表示する。
    // 削除するとストア／DBから即時に消えるため、消す前にスナップショットを退避し、
    // Undo 時はそのスナップショットから配置を再作成する（新IDで復元）。
    const handleDeleteWithUndo = useCallback(async (id: string) => {
        const snapshot = useCalendarStore.getState().assignments.find((a) => a.id === id);
        let logId: string | null = null;
        try {
            logId = await deleteProject(id);
        } catch (e) {
            logger.error('Failed to delete assignment:', e);
            toast.error('削除に失敗しました');
            return;
        }
        if (!snapshot) return;
        const pm = snapshot.projectMaster;
        const label = pm?.name ? `${pm.name}${pm.honorific ?? ''}` : (pm?.title || '案件');
        showUndoToast({
            message: `${label} を削除しました`,
            onUndo: async () => {
                try {
                    // 通常は削除控え（logId）から復元。控えが取れなかった場合のみスナップショットで再作成。
                    if (logId) {
                        await restoreDeletedAssignment(logId);
                    } else {
                        await restoreAssignment(snapshot);
                    }
                    toast.success('削除を取り消しました');
                } catch (e) {
                    logger.error('Failed to restore assignment:', e);
                    toast.error('元に戻せませんでした');
                }
            },
        });
    }, [deleteProject, restoreAssignment, restoreDeletedAssignment]);

    // 日別メンバー調整
    const memberAdjustments = useCalendarStore((state) => state.memberAdjustments);
    const setMemberAdjustment = useCalendarStore((state) => state.setMemberAdjustment);

    // ヘッダー残り人数・セルメモが揃っているか（部分ロードで誤値表示を防ぐ）
    const cellRemarksInitialized = useCalendarStore((state) => state.cellRemarksInitialized);
    const memberAdjustmentsInitialized = useCalendarStore((state) => state.memberAdjustmentsInitialized);
    const vacationsInitialized = useCalendarStore((state) => state.vacationsInitialized);
    const calendarDataReady = cellRemarksInitialized && memberAdjustmentsInitialized && vacationsInitialized;

    // ローディング滞留の見張り: スピナーが一定時間解けない場合に再読み込み導線を出す。
    // 初回フェッチがストールするとゲートを解除する術がなく固まるため、
    // フェッチ側のタイムアウト（fetchWithTimeout）と二段構えの保険にする
    const isLoadingGateClosed = !isMounted || isCalendarLoading || !isInitialized || isMobile === null
        || !calendarDataReady;
    const [showStuckReload, setShowStuckReload] = useState(false);
    useEffect(() => {
        if (!isLoadingGateClosed) {
            setShowStuckReload(false);
            return;
        }
        const timer = setTimeout(() => setShowStuckReload(true), 10_000);
        return () => clearTimeout(timer);
    }, [isLoadingGateClosed]);
    // 連打対応: pendingは即時UI反映、一定時間後にまとめて確認ダイアログ
    const [pendingAdjustments, setPendingAdjustments] = useState<Record<string, number>>({});
    const pendingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const pendingToastIdsRef = useRef<Record<string, string>>({});
    const getMemberAdjustmentCb = useCallback((dateKey: string) => {
        return (memberAdjustments[dateKey] || 0) + (pendingAdjustments[dateKey] || 0);
    }, [memberAdjustments, pendingAdjustments]);

    const clearPending = useCallback((dateKey: string) => {
        setPendingAdjustments(prev => {
            if (!(dateKey in prev)) return prev;
            const rest = { ...prev };
            delete rest[dateKey];
            return rest;
        });
    }, []);

    const commitPending = useCallback((dateKey: string, delta: number) => {
        const current = useCalendarStore.getState().memberAdjustments[dateKey] || 0;
        setMemberAdjustment(dateKey, current + delta);
        clearPending(dateKey);
    }, [setMemberAdjustment, clearPending]);

    const promptConfirmAdjustment = useCallback((dateKey: string) => {
        // 最新のpending値を取得するためsetterパターンで読む
        setPendingAdjustments(prev => {
            const pendingDelta = prev[dateKey] || 0;
            if (pendingDelta === 0) {
                if (pendingToastIdsRef.current[dateKey]) {
                    toast.dismiss(pendingToastIdsRef.current[dateKey]);
                    delete pendingToastIdsRef.current[dateKey];
                }
                const rest = { ...prev };
                delete rest[dateKey];
                return rest;
            }

            // 既存のトーストがあれば閉じて新しく出し直す
            if (pendingToastIdsRef.current[dateKey]) {
                toast.dismiss(pendingToastIdsRef.current[dateKey]);
            }

            // 日付表示
            const [, m, d] = dateKey.split('-');
            const dateLabel = `${Number(m)}/${Number(d)}`;
            const sign = pendingDelta > 0 ? '+' : '';
            const message = `${dateLabel} の残り人数を ${sign}${pendingDelta}人 変更しますか？`;

            const id = toast.custom(
                (t) => (
                    <div
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-slate-800 text-white ${t.visible ? 'animate-enter' : 'animate-leave'}`}
                    >
                        <span className="text-sm whitespace-nowrap">{message}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                onClick={() => {
                                    toast.dismiss(t.id);
                                    delete pendingToastIdsRef.current[dateKey];
                                    commitPending(dateKey, pendingDelta);
                                }}
                                className="px-3 py-1 text-xs font-semibold rounded-lg bg-white text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                            >
                                はい
                            </button>
                            <button
                                onClick={() => {
                                    toast.dismiss(t.id);
                                    delete pendingToastIdsRef.current[dateKey];
                                    clearPending(dateKey);
                                }}
                                className="px-3 py-1 text-xs font-semibold rounded-lg bg-slate-600 text-white hover:bg-slate-500 whitespace-nowrap"
                            >
                                いいえ
                            </button>
                        </div>
                    </div>
                ),
                { duration: 8000, position: 'bottom-center' }
            );
            pendingToastIdsRef.current[dateKey] = id;
            // トーストが自動消滅した時に pending が残るのを防ぐ（duration と同期して破棄）
            setTimeout(() => {
                if (pendingToastIdsRef.current[dateKey] === id) {
                    delete pendingToastIdsRef.current[dateKey];
                    clearPending(dateKey);
                }
            }, 8000);
            return prev;
        });
    }, [commitPending, clearPending]);

    const handleMemberAdjustmentChange = useCallback((dateKey: string, delta: number) => {
        // pendingに即時反映（UIがすぐ更新される）
        setPendingAdjustments(prev => ({
            ...prev,
            [dateKey]: (prev[dateKey] || 0) + delta,
        }));

        // 連打対応: 既存タイマーをリセットして1.2秒後にまとめて確認
        if (pendingTimersRef.current[dateKey]) {
            clearTimeout(pendingTimersRef.current[dateKey]);
        }
        pendingTimersRef.current[dateKey] = setTimeout(() => {
            delete pendingTimersRef.current[dateKey];
            promptConfirmAdjustment(dateKey);
        }, 1200);
    }, [promptConfirmAdjustment]);

    // アンマウント時にタイマーを掃除
    useEffect(() => {
        return () => {
            Object.values(pendingTimersRef.current).forEach(clearTimeout);
            pendingTimersRef.current = {};
            Object.values(pendingToastIdsRef.current).forEach(id => toast.dismiss(id));
            pendingToastIdsRef.current = {};
        };
    }, []);

    // ローディング（isMobileがnullの間 = SSR/マウント前も含む）
    // 残り人数・セルメモは副次データに見えるが実際にはヘッダーとセルに直接効くため、
    // 初期化が完了するまで描画しない（部分ロード状態で誤った値が表示されるのを防ぐ）
    if (isLoadingGateClosed) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-lg shadow-sm border border-slate-200 min-h-[400px]">
                <Loading size="lg" text="週間スケジュールを読み込み中..." />
                {showStuckReload && (
                    <div className="mt-6 flex flex-col items-center gap-2">
                        <p className="text-sm text-slate-500">読み込みに時間がかかっています</p>
                        <Button variant="outline" onClick={() => window.location.reload()}>
                            再読み込み
                        </Button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <>
            {/* カレンダービュー: PC / モバイル切替 */}
            {isMobile ? (
                <MobileCalendarView
                    weekDays={weekDays}
                    events={events}
                    employeeRows={employeeRows}
                    projects={projects}
                    isReadOnly={isReadOnly}
                    canDispatch={canDispatch}
                    isSaving={isSaving}
                    getTotalMembersForDate={getTotalMembersForDate}
                    getVacationEmployees={getVacationEmployees}
                    getEditingUsers={getEditingUsers}
                    goToPreviousWeek={navGoToPreviousWeek}
                    goToNextWeek={navGoToNextWeek}
                    goToPreviousDay={navGoToPreviousDay}
                    goToNextDay={navGoToNextDay}
                    goToToday={goToToday}
                    canGoPrevWeek={canGoPrevWeek}
                    canGoNextWeek={canGoNextWeek}
                    canGoPrevDay={canGoPrevDay}
                    canGoNextDay={canGoNextDay}
                    handleEventClick={handleEventClick}
                    handleCellClick={isReadOnly ? undefined : handleCellClick}
                    handleMoveEvent={isReadOnly ? undefined : handleMoveEvent}
                    handleOpenDispatchModal={isReadOnly ? undefined : handleOpenDispatchModal}
                    handleCopyEvent={isReadOnly ? undefined : handleCopyEvent}
                    handleMoveToCell={isReadOnly ? undefined : handleMoveToCell}
                    handleOpenSearch={partnerMode ? undefined : handleOpenSearch}
                    highlightedEventId={highlightedEventId}
                    getMemberAdjustment={getMemberAdjustmentCb}
                    onMemberAdjustmentChange={isReadOnly ? undefined : handleMemberAdjustmentChange}
                    hideRemarks={partnerMode}
                    handleFloatingEventClick={canSeeFloatingLane ? handleFloatingEventClick : undefined}
                    handleFloatingCellClick={isReadOnly || !canSeeFloatingLane ? undefined : handleFloatingCellClick}
                    floatingLaneAnchorId={floatingLaneAnchorId}
                    hideFloatingLane={!canSeeFloatingLane}
                />
            ) : (
                <DesktopCalendarView
                    weekDays={weekDays}
                    events={events}
                    employeeRows={employeeRows}
                    projects={projects}
                    activeEvent={activeEvent}
                    isReadOnly={isReadOnly}
                    canDispatch={canDispatch}
                    isSaving={isSaving}
                    getTotalMembersForDate={getTotalMembersForDate}
                    getEditingUsers={getEditingUsers}
                    handleDragStart={handleDragStart}
                    handleDragOver={handleDragOver}
                    handleDragEnd={handleDragEnd}
                    handleDragCancel={handleDragCancel}
                    handleEventClick={handleEventClick}
                    handleCellClick={isReadOnly ? undefined : handleCellClick}
                    handleMoveEvent={isReadOnly ? undefined : handleMoveEvent}
                    removeForeman={isReadOnly ? undefined : removeForeman}
                    moveForeman={isReadOnly ? undefined : moveForeman}
                    handleOpenDispatchModal={isReadOnly ? undefined : handleOpenDispatchModal}
                    handleCopyEvent={isReadOnly ? undefined : handleCopyEvent}
                    handleMoveToCell={isReadOnly ? undefined : handleMoveToCell}
                    highlightedEventId={highlightedEventId}
                    getMemberAdjustment={getMemberAdjustmentCb}
                    onMemberAdjustmentChange={isReadOnly ? undefined : handleMemberAdjustmentChange}
                    hideRemarks={partnerMode}
                    hideForemanSelector={partnerMode}
                    goToPreviousWeek={partnerMode ? navGoToPreviousWeek : undefined}
                    goToNextWeek={partnerMode ? navGoToNextWeek : undefined}
                    goToToday={partnerMode ? goToToday : undefined}
                    weekLabel={partnerMode ? weekLabel : undefined}
                    canGoPrevWeek={canGoPrevWeek}
                    canGoNextWeek={canGoNextWeek}
                    handleFloatingEventClick={canSeeFloatingLane ? handleFloatingEventClick : undefined}
                    handleFloatingCellClick={isReadOnly || !canSeeFloatingLane ? undefined : handleFloatingCellClick}
                    floatingLaneAnchorId={floatingLaneAnchorId}
                    hideFloatingLane={!canSeeFloatingLane}
                    moveFloatingLane={isReadOnly ? undefined : moveFloatingLane}
                    canMoveFloatingLaneUp={canMoveFloatingLaneUp}
                    canMoveFloatingLaneDown={canMoveFloatingLaneDown}
                />
            )}

            {/* モーダル群（PC/モバイル共通） */}
            <ProjectModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSubmit={handleSaveProject}
                onDelete={handleDeleteWithUndo}
                initialData={modalInitialData.projectMasterId || modalInitialData.id ? modalInitialData : undefined}
                defaultDate={modalInitialData.startDate}
                defaultEmployeeId={modalInitialData.assignedEmployeeId}
                title={modalInitialData.id ? '案件編集' : '案件登録'}
                readOnly={isReadOnly}
                onEditProjectMaster={
                    canEditProjectMaster && modalInitialData.projectMasterId
                        ? handleEditProjectMaster
                        : undefined
                }
                onDemoteToFloating={
                    !isReadOnly && canSeeFloatingLane && modalInitialData.id && modalInitialData.assignedEmployeeId !== 'unassigned'
                        ? handleDemoteToFloating
                        : undefined
                }
            />

            <ProjectMasterSearchModal
                isOpen={isSearchModalOpen}
                onClose={handleCloseSearchModal}
                onSelect={handleSelectProjectMaster}
                onCreateNew={() => {
                    setModalInitialData({ startDate: cellContext?.date, assignedEmployeeId: cellContext?.employeeId });
                    setIsModalOpen(true);
                }}
            />

            {dispatchProject && (
                <DispatchConfirmModal isOpen={isDispatchModalOpen} onClose={handleCloseDispatchModal} project={dispatchProject} />
            )}

            {promoteEvent && (
                <FloatingPromoteModal
                    isOpen={promoteEvent !== null}
                    onClose={() => setPromoteEvent(null)}
                    event={promoteEvent}
                    projects={projects}
                    foremen={employeeRows.map(r => ({ id: r.employeeId, name: r.employeeName }))}
                    onPromote={handlePromoteFloating}
                    onEdit={handleEventClick}
                    isReadOnly={isReadOnly}
                />
            )}

            <CopyAssignmentModal
                isOpen={isCopyModalOpen}
                onClose={handleCloseCopyModal}
                event={copyEvent}
                employees={allForemen.map(f => ({ id: f.id, name: f.displayName }))}
                onCopy={handleCopyAssignment}
            />

            <ProjectSelectionModal
                isOpen={isSelectionModalOpen}
                onClose={handleSelectionCancel}
                onSelectExisting={handleSelectExisting}
                onCreateNew={handleCreateNew}
            />

            <ConflictResolutionModal
                isOpen={conflictModalOpen}
                onClose={() => {
                    setConflictModalOpen(false);
                    setConflictData(null);
                }}
                onResolve={handleConflictResolution}
                latestData={conflictData?.latestData}
                conflictMessage={conflictData?.message}
            />

            {pendingMove && (
                <MoveConfirmModal
                    isOpen={isMoveModalOpen}
                    pendingMove={pendingMove}
                    eventTitle={
                        pendingMove.title ??
                        projects.find(
                            p => p.id === pendingMove.eventId.replace(/-assembly$|-demolition$/, '')
                        )?.title
                    }
                    fromForemanName={pendingMove.fromEmployeeId === 'unassigned'
                        ? '浮き（班未定）'
                        : allForemen.find(f => f.id === pendingMove.fromEmployeeId)?.displayName}
                    toForemanName={allForemen.find(f => f.id === pendingMove.toEmployeeId)?.displayName}
                    availableVehicles={availableVehiclesData?.available ?? null}
                    inUseVehicles={availableVehiclesData?.inUse ?? []}
                    onConfirmKeep={handleMoveKeep}
                    onConfirmReassign={handleMoveReassign}
                    onCancel={handleMoveCancel}
                />
            )}

            <ScheduleSearchPanel
                isOpen={isSearchOpen}
                onClose={handleCloseSearch}
                onJump={handleSearchJump}
            />

        </>
    );
}
