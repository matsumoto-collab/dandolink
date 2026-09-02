'use client';

import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { Project, CalendarEvent, ProjectAssignment, ProjectMaster, DEFAULT_CONSTRUCTION_TYPE_COLORS } from '@/types/calendar';
import { useMasterStore } from '@/stores/masterStore';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { initBroadcastChannel, onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import { formatDateKey } from '@/utils/employeeUtils';
import { parseWalTimestamp } from '@/lib/walTimestamp';
import { logger } from '@/lib/logger';

// Re-export types for backward compatibility
export type { Project, CalendarEvent, ProjectAssignment, ProjectMaster } from '@/types/calendar';

// Re-export ConflictUpdateError for use in components
export { ConflictUpdateError } from '@/stores/calendarStore';

// ---- Realtime同期のモジュールスコープ状態 ----
// ストア（useCalendarStore）はアプリ全体で1つなので、「ロード済みの表示日付範囲」も
// モジュールで1つ持つ。以前は useProjects インスタンスごとの ref だったため、
// モーダル等の別インスタンスの購読が範囲不明のまま無条件 upsert する歪みがあった。
let currentDateRange: { start: string; end: string } | null = null;

// Realtime/broadcast で届いた変更IDのキュー。
// 同じ変更が Supabase broadcast と postgres_changes(WAL) の二重で届いたり、
// 一括操作でIDが連続で届いたりするため、IDを Set に貯めて500msデバウンスで
// まとめて1回フェッチ→1回の set で反映する（従来はIDごとに個別フェッチ+set が走り、
// 閲覧中の端末でもイベントのたびにカレンダー全体が再レンダーされていた）。
const pendingSyncIds = new Set<string>();
let syncFlushTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_FLUSH_DEBOUNCE_MS = 500;
// これを超えるIDが貯まったら個別取得をやめて表示範囲の一括再フェッチに切り替える
// （fetchAssignments 側に内容不変スキップがあるため二重反映のコストは低い）
const SYNC_IDS_LIMIT = 50;

type AssignmentWithMaster = ProjectAssignment & { projectMaster?: ProjectMaster };

// APIレスポンスの日付文字列を Date 化する（fetchAssignments と同じ流儀）
function parseAssignmentDates(data: AssignmentWithMaster & {
    date: string; createdAt: string; updatedAt: string;
    workStartedAt?: string | null; workEndedAt?: string | null;
    projectMaster?: ProjectMaster & { createdAt: string; updatedAt: string };
}): AssignmentWithMaster {
    return {
        ...data,
        date: new Date(data.date),
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        workStartedAt: data.workStartedAt ? new Date(data.workStartedAt) : null,
        workEndedAt: data.workEndedAt ? new Date(data.workEndedAt) : null,
        confirmDueDate: data.confirmDueDate ? new Date(data.confirmDueDate) : null,
        projectMaster: data.projectMaster ? {
            ...data.projectMaster,
            createdAt: new Date(data.projectMaster.createdAt),
            updatedAt: new Date(data.projectMaster.updatedAt),
        } : undefined,
    };
}

function scheduleAssignmentSync(id: string | null | undefined): void {
    // ガード: broadcast/Realtime payload に id が欠けて undefined が流入することがあり、
    // 文字列 "undefined" として URL に埋め込まれて 404 を量産する事故を防ぐ
    if (!id) return;
    pendingSyncIds.add(id);
    if (syncFlushTimer) clearTimeout(syncFlushTimer);
    syncFlushTimer = setTimeout(() => { void flushAssignmentSync(); }, SYNC_FLUSH_DEBOUNCE_MS);
}

async function flushAssignmentSync(): Promise<void> {
    syncFlushTimer = null;
    const ids = Array.from(pendingSyncIds);
    pendingSyncIds.clear();
    if (ids.length === 0) return;
    try {
        if (ids.length > SYNC_IDS_LIMIT) {
            const store = useCalendarStore.getState();
            if (currentDateRange) {
                await store.fetchAssignments(currentDateRange.start, currentDateRange.end, 0, { silent: true });
            } else {
                await store.fetchAssignments(undefined, undefined, 0, { silent: true });
            }
            return;
        }
        const url = ids.length === 1
            ? `/api/assignments/${ids[0]}`
            : `/api/assignments?ids=${ids.join(',')}`;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) return; // 404=削除済み等。削除は DELETE イベント側が担う
        const data = await response.json();
        const parsed: AssignmentWithMaster[] = (Array.isArray(data) ? data : [data]).map(parseAssignmentDates);
        const range = currentDateRange;
        const inRange: AssignmentWithMaster[] = [];
        const removeIds: string[] = [];
        for (const assignment of parsed) {
            const dateKey = formatDateKey(assignment.date);
            if (!range || (dateKey >= range.start && dateKey <= range.end)) {
                inRange.push(assignment);
            } else {
                // 表示範囲外へ移動された配置は旧位置の残骸を掃除（従来はポーリングまで残った）
                removeIds.push(assignment.id);
            }
        }
        useCalendarStore.getState().upsertAssignments(inRange, removeIds);
    } catch (error) {
        logger.error('Failed to sync assignments from realtime events:', error);
    }
}

// テスト専用: モジュールスコープの同期状態をリセットする
export function __resetAssignmentSyncForTests(): void {
    currentDateRange = null;
    pendingSyncIds.clear();
    if (syncFlushTimer) {
        clearTimeout(syncFlushTimer);
        syncFlushTimer = null;
    }
}

// This hook wraps the Zustand store and handles initialization/realtime
export function useProjects() {
    const { status } = useSession();
    const [isUpdating, setIsUpdating] = useState(false);
    const isUpdatingRef = useRef(isUpdating);
    isUpdatingRef.current = isUpdating;
    const timeoutRefs = useRef<NodeJS.Timeout[]>([]);

    // Get state from Zustand store
    const isLoading = useCalendarStore((state) => state.projectsLoading);
    const isInitialized = useCalendarStore((state) => state.projectsInitialized);

    // Get actions from Zustand store
    const fetchAssignmentsStore = useCalendarStore((state) => state.fetchAssignments);
    const addProjectStore = useCalendarStore((state) => state.addProject);
    const updateProjectStore = useCalendarStore((state) => state.updateProject);
    const updateProjectsStore = useCalendarStore((state) => state.updateProjects);
    const demoteToFloatingStore = useCalendarStore((state) => state.demoteToFloating);
    const deleteProjectStore = useCalendarStore((state) => state.deleteProject);
    const restoreAssignmentStore = useCalendarStore((state) => state.restoreAssignment);
    const restoreDeletedAssignmentStore = useCalendarStore((state) => state.restoreDeletedAssignment);
    const getProjectByIdStore = useCalendarStore((state) => state.getProjectById);
    const getCalendarEventsStore = useCalendarStore((state) => state.getCalendarEvents);
    const fetchCellRemarksStore = useCalendarStore((state) => state.fetchCellRemarks);
    const fetchMemberAdjustmentsStore = useCalendarStore((state) => state.fetchMemberAdjustments);
    const fetchVacationsStore = useCalendarStore((state) => state.fetchVacations);
    const removeAssignmentByIdStore = useCalendarStore((state) => state.removeAssignmentById);
    const updateProjectMasterInAssignmentsStore = useCalendarStore((state) => state.updateProjectMasterInAssignments);

    // Cleanup timeouts on unmount
    useEffect(() => {
        return () => {
            timeoutRefs.current.forEach(clearTimeout);
            timeoutRefs.current = [];
        };
    }, []);

    // BroadcastChannel: 同一デバイスの別タブ（PC↔モバイル）へ変更を通知
    // Supabase Realtime が同一ブラウザ内でブロックされる問題を補完する
    const broadcastRef = useRef<BroadcastChannel | null>(null);

    // Reset state when unauthenticated
    useEffect(() => {
        if (status === 'unauthenticated') {
            currentDateRange = null;
        }
    }, [status]);

    // Debounced fetch to prevent rapid-fire API calls hitting rate limits
    const fetchDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const fetchResolversRef = useRef<Array<() => void>>([]);

    // Fetch for a specific date range (debounced: 300ms)
    const fetchForDateRange = useCallback(async (startDate: Date, endDate: Date) => {
        const startStr = formatDateKey(startDate);
        const endStr = formatDateKey(endDate);

        // Skip if same range is already loaded and has data
        const currentRange = currentDateRange;
        const { projectsInitialized, assignments } = useCalendarStore.getState();
        if (currentRange?.start === startStr && currentRange?.end === endStr && projectsInitialized && assignments.length > 0) {
            return;
        }

        // Debounce: cancel pending fetch, schedule a new one
        if (fetchDebounceRef.current) {
            clearTimeout(fetchDebounceRef.current);
        }

        return new Promise<void>((resolve) => {
            fetchResolversRef.current.push(resolve);
            fetchDebounceRef.current = setTimeout(async () => {
                fetchDebounceRef.current = null;
                const resolvers = [...fetchResolversRef.current];
                fetchResolversRef.current = [];

                currentDateRange = { start: startStr, end: endStr };

                // セルメモ・人数調整はカレンダーヘッダー/セルに直接効く一次データ。
                // 遅延フェッチすると初回paintで残り人数が誤算出され、メモも欠落するため
                // assignmentsと並列で即時フェッチする（!Initialized ガードで重複は防ぐ）
                const storeBefore = useCalendarStore.getState();
                const sideFetches: Promise<void>[] = [];
                if (!storeBefore.cellRemarksInitialized) sideFetches.push(fetchCellRemarksStore());
                if (!storeBefore.memberAdjustmentsInitialized) sideFetches.push(fetchMemberAdjustmentsStore());

                await Promise.all([
                    fetchAssignmentsStore(startStr, endStr),
                    ...sideFetches,
                ]);

                resolvers.forEach(r => r());
            }, 300);
        });
    }, [fetchAssignmentsStore, fetchCellRemarksStore, fetchMemberAdjustmentsStore]);

    // Supabase Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: RealtimeChannel | null = null;

        // INSERT/UPDATE 共通: payload.new.date で表示範囲を事前判定し、範囲外なら
        // フェッチ自体を省く（従来は全社の全変更で毎回フェッチ+再レンダーが走っていた）。
        // 範囲内→範囲外へ移動された配置はストアから掃除する。
        const handleAssignmentUpserted = (payload: { new: Record<string, unknown> }) => {
            if (isUpdatingRef.current) return;
            const id = payload.new?.id as string | undefined;
            if (!id) return;
            const range = currentDateRange;
            const rawDate = payload.new?.date as string | undefined;
            if (range && rawDate) {
                // WALのtimestampはタイムゾーン表記なしのUTC文字列。素のnew Date()だと
                // JST環境で日付が1日前にズレ、週初日の配置を誤って範囲外掃除していた
                const parsed = parseWalTimestamp(rawDate);
                if (!isNaN(parsed.getTime())) {
                    const dateKey = formatDateKey(parsed);
                    if (dateKey < range.start || dateKey > range.end) {
                        if (useCalendarStore.getState().assignments.some((a) => a.id === id)) {
                            removeAssignmentByIdStore(id);
                        }
                        return;
                    }
                }
                // パース不能な形式は範囲判定せずフェッチに回す（flush側が正しい日付で再判定する）
            }
            scheduleAssignmentSync(id);
        };

        const setupRealtime = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                channel = supabase
                    .channel('project_assignments_changes_zustand')
                    // ProjectAssignment: INSERT/UPDATE → キューに積んでまとめて取得・反映
                    .on(
                        'postgres_changes',
                        { event: 'INSERT', schema: 'public', table: 'ProjectAssignment' },
                        handleAssignmentUpserted
                    )
                    .on(
                        'postgres_changes',
                        { event: 'UPDATE', schema: 'public', table: 'ProjectAssignment' },
                        handleAssignmentUpserted
                    )
                    // ProjectAssignment: DELETE → APIコールなしでstoreから削除
                    .on(
                        'postgres_changes',
                        { event: 'DELETE', schema: 'public', table: 'ProjectAssignment' },
                        (payload) => {
                            if (!isUpdatingRef.current) {
                                removeAssignmentByIdStore(payload.old.id as string);
                            }
                        }
                    )
                    // ProjectMaster: INSERT/UPDATE → 関連する配置のprojectMasterデータを更新
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'ProjectMaster' },
                        async (payload) => {
                            if (!isUpdatingRef.current) {
                                // DELETE の場合は対応するアサインも削除されるので無視
                                if (payload.eventType === 'DELETE') return;
                                const pmId = (payload.new as { id?: string })?.id;
                                if (!pmId) return;
                                try {
                                    const res = await fetch(`/api/project-masters/${pmId}`);
                                    if (res.ok) {
                                        const pm = await res.json();
                                        updateProjectMasterInAssignmentsStore({
                                            ...pm,
                                            createdAt: new Date(pm.createdAt),
                                            updatedAt: new Date(pm.updatedAt),
                                        });
                                    }
                                } catch (error) {
                                    logger.error('Failed to sync project master:', error);
                                }
                            }
                        }
                    )
                    .subscribe();
            } catch (error) {
                logger.error('Failed to setup realtime:', error);
            }
        };

        setupRealtime();

        return () => {
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase')
                    .then(({ supabase }) => {
                        supabase.removeChannel(channelToRemove);
                    })
                    .catch(() => {
                        // クリーンアップ時のエラーは無視（コンポーネントは既にアンマウント済み）
                    });
            }
        };
    }, [status, removeAssignmentByIdStore, updateProjectMasterInAssignmentsStore]);

    // Supabase broadcast シングルトンを初期化し、案件配置・セル備考の受信リスナーを登録
    // 起動直後のネットワーク集中を避けるため、初期化を少し遅らせる
    useEffect(() => {
        if (status !== 'authenticated') return;

        const initTimer = setTimeout(() => initBroadcastChannel(), 800);

        const cleanups = [
            onBroadcast('assignment_updated', (payload) => {
                if (!isUpdatingRef.current && payload?.id) {
                    scheduleAssignmentSync(payload.id as string);
                }
            }),
            onBroadcast('assignments_batch_updated', (payload) => {
                if (!isUpdatingRef.current && Array.isArray(payload?.ids)) {
                    (payload.ids as string[]).forEach((id: string) => scheduleAssignmentSync(id));
                }
            }),
            onBroadcast('assignment_deleted', (payload) => {
                if (!isUpdatingRef.current && payload?.id) {
                    removeAssignmentByIdStore(payload.id as string);
                }
            }),
            onBroadcast('cell_remark_updated', () => {
                useCalendarStore.getState().fetchCellRemarks();
            }),
            onBroadcast('member_adjustment_updated', () => {
                useCalendarStore.getState().fetchMemberAdjustments();
            }),
        ];

        return () => {
            clearTimeout(initTimer);
            cleanups.forEach(cleanup => cleanup());
        };
    }, [status, removeAssignmentByIdStore]);

    // BroadcastChannel セットアップ（同一デバイスの別タブへ通知）
    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const ch = new BroadcastChannel('dandolink_assignments_v1');
        broadcastRef.current = ch;

        ch.addEventListener('message', (event) => {
            if (isUpdatingRef.current) return; // 自分が更新中なら無視
            const { type, id, ids } = event.data ?? {};
            if (type === 'assignment_updated' && id) {
                scheduleAssignmentSync(id);
            } else if (type === 'assignments_batch_updated' && Array.isArray(ids)) {
                ids.forEach((assignmentId: string) => scheduleAssignmentSync(assignmentId));
            } else if (type === 'assignment_deleted' && id) {
                removeAssignmentByIdStore(id);
            }
        });

        return () => {
            ch.close();
            broadcastRef.current = null;
        };
    }, [removeAssignmentByIdStore]);

    // Wrapper functions for backward compatibility
    const addProject = useCallback(async (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        // リアルタイム購読がfetchを呼ばないよう保護
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            await addProjectStore(project);
            // addProjectStoreで既にサーバーレスポンスをローカル状態に追加しているため、
            // fetchAssignmentsStoreは不要（呼び出すとドラッグ操作と競合する）
        } finally {
            const tid = setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
                timeoutRefs.current = timeoutRefs.current.filter(t => t !== tid);
            }, 5000); // 複数日一括作成時のリアルタイム通知を確実にブロックするため長めに
            timeoutRefs.current.push(tid);
        }
    }, [addProjectStore]);

    const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
        // リアルタイム購読がfetchを呼ばないよう、先にrefを更新
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            await updateProjectStore(id, updates);
            // 同一デバイスの別タブへ即時通知（PC↔モバイル連携）
            broadcastRef.current?.postMessage({ type: 'assignment_updated', id });
            // 別デバイスへ即時通知（Supabase Realtime broadcast - WALより高速）
            sendBroadcast('assignment_updated', { id });
        } finally {
            const tid = setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
                timeoutRefs.current = timeoutRefs.current.filter(t => t !== tid);
            }, 500);
            timeoutRefs.current.push(tid);
        }
    }, [updateProjectStore]);

    // 配置を浮き（班未定）に戻す＝降格。updateProject と同じ isUpdating ガード＋broadcast パターン。
    // date を渡すと降格と同時に別日へ移動する（浮きレーンの別日セルへドロップ/移動）。
    const demoteToFloating = useCallback(async (id: string, date?: Date) => {
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            await demoteToFloatingStore(id, date);
            broadcastRef.current?.postMessage({ type: 'assignment_updated', id });
            sendBroadcast('assignment_updated', { id });
        } finally {
            const tid = setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
                timeoutRefs.current = timeoutRefs.current.filter(t => t !== tid);
            }, 500);
            timeoutRefs.current.push(tid);
        }
    }, [demoteToFloatingStore]);

    const updateProjects = useCallback(async (updates: Array<{ id: string; data: Partial<Project> }>) => {
        // リアルタイム購読がfetchを呼ばないよう、先にrefを更新
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            await updateProjectsStore(updates);
            // 万一 updates 側で id が欠落していても broadcast 経由で
            // /api/assignments/undefined を叩かないよう truthy チェック
            const ids = updates.map(u => u.id).filter((id): id is string => Boolean(id));
            // 同一デバイスの別タブへ即時通知
            broadcastRef.current?.postMessage({ type: 'assignments_batch_updated', ids });
            // 別デバイスへ即時通知（Supabase Realtime broadcast）
            sendBroadcast('assignments_batch_updated', { ids });
        } finally {
            const tid = setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
                timeoutRefs.current = timeoutRefs.current.filter(t => t !== tid);
            }, 500);
            timeoutRefs.current.push(tid);
        }
    }, [updateProjectsStore]);

    const deleteProject = useCallback(async (id: string) => {
        const logId = await deleteProjectStore(id);
        // 同一デバイスの別タブへ即時通知
        broadcastRef.current?.postMessage({ type: 'assignment_deleted', id });
        // 別デバイスへ即時通知（Supabase Realtime broadcast）
        sendBroadcast('assignment_deleted', { id });
        return logId;
    }, [deleteProjectStore]);

    // 誤削除のUndo: スナップショットから配置を再作成する（控えが使えないとき用のフォールバック）。
    // addProject 同様 isUpdating ガードを張り、Realtime の二重反映を防ぐ。
    const restoreAssignment = useCallback(async (snapshot: Parameters<typeof restoreAssignmentStore>[0]) => {
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            const created = await restoreAssignmentStore(snapshot);
            // 同一デバイスの別タブ／別デバイスへ即時通知（新IDで作成された配置を反映）
            broadcastRef.current?.postMessage({ type: 'assignment_updated', id: created.id });
            sendBroadcast('assignment_updated', { id: created.id });
            return created;
        } finally {
            const tid = setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
                timeoutRefs.current = timeoutRefs.current.filter(t => t !== tid);
            }, 500);
            timeoutRefs.current.push(tid);
        }
    }, [restoreAssignmentStore]);

    // 誤削除のUndo（通常経路）: サーバーの削除控え（logId）から復元する。
    const restoreDeletedAssignment = useCallback(async (logId: string) => {
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            const created = await restoreDeletedAssignmentStore(logId);
            broadcastRef.current?.postMessage({ type: 'assignment_updated', id: created.id });
            sendBroadcast('assignment_updated', { id: created.id });
            return created;
        } finally {
            const tid = setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
                timeoutRefs.current = timeoutRefs.current.filter(t => t !== tid);
            }, 500);
            timeoutRefs.current.push(tid);
        }
    }, [restoreDeletedAssignmentStore]);

    const getProjectById = useCallback((id: string) => {
        return getProjectByIdStore(id);
    }, [getProjectByIdStore]);

    const getCalendarEvents = useCallback((): CalendarEvent[] => {
        return getCalendarEventsStore();
    }, [getCalendarEventsStore]);

    const refreshProjects = useCallback(async () => {
        // 表示中の範囲が分かっていればその範囲のみ再取得（全件フェッチ回避）。
        // 範囲未確定（カレンダー未マウント等）の場合のみ従来どおり全件。
        const range = currentDateRange;
        currentDateRange = null;
        if (range) {
            await fetchAssignmentsStore(range.start, range.end);
            currentDateRange = range;
        } else {
            await fetchAssignmentsStore();
        }
    }, [fetchAssignmentsStore]);

    // ポーリング用: 指定範囲を強制再フェッチ（Realtime補完）
    // 副次データ（memberAdjustments / vacations / cellRemarks）はbroadcast頼みで
    // 一度欠落するとリロードまで自己回復しなかったため、ここでまとめて再フェッチして
    // 残り人数の整合を保証する
    const forceRefreshRange = useCallback(async (startDate: Date, endDate: Date) => {
        if (isUpdatingRef.current) return; // 自分が更新中なら跳ばす
        const startStr = formatDateKey(startDate);
        const endStr = formatDateKey(endDate);
        currentDateRange = null; // キャッシュをクリアして強制再フェッチ
        // 副次データもポーリングでは表示範囲のみ再取得（全件フェッチはテーブル成長とともに肥大するため）。
        // ストア側は範囲内キーだけ差し替えるので、範囲外の既存キャッシュは消えない。
        const sideRange = { from: startStr, to: endStr };
        // silent: ポーリングでは loading フラグを立てない。データ不変でもトグルだけで
        // 非memoのカレンダー全体が2回再レンダーされ、常時表示端末の発熱源になるため
        await Promise.all([
            fetchAssignmentsStore(startStr, endStr, 0, { silent: true }),
            fetchMemberAdjustmentsStore(sideRange),
            fetchVacationsStore(sideRange, { silent: true }),
            fetchCellRemarksStore(sideRange, { silent: true }),
        ]);
        currentDateRange = { start: startStr, end: endStr };
    }, [fetchAssignmentsStore, fetchMemberAdjustmentsStore, fetchVacationsStore, fetchCellRemarksStore]);

    // Subscribe to assignments changes to trigger re-renders
    const assignments = useCalendarStore((state) => state.assignments);

    // マスターデータから工事種別を取得
    const constructionTypes = useMasterStore((state) => state.constructionTypes);

    // Get projects from store (now reactive because we subscribe to assignments)
    // useMemo化: assignments / constructionTypes が変わらない限り同じ参照を返す。
    // これを毎レンダー新しい配列で返すと、これを deps に持つ useEffect が
    // 暴走（無限ループ）する原因になる（過去事故あり）。
    const projects = useMemo(() => assignments.map((a) => {
        // 配置ごとのconstructionTypeを優先、なければProjectMasterから取得
        const constructionType = a.constructionType || a.projectMaster?.constructionType || 'other';
        // マスターデータから色を取得
        const masterType = constructionTypes.find(ct => ct.id === constructionType || ct.name === constructionType);
        const color = masterType?.color || DEFAULT_CONSTRUCTION_TYPE_COLORS[constructionType] || DEFAULT_CONSTRUCTION_TYPE_COLORS.other;

        // カード表示用: name+honorific+siteShortName（工事名称なし）。nameが無い旧データはtitleにフォールバック
        const pm = a.projectMaster;
        const hasNameField = !!pm?.name;
        const site = (pm as any)?.siteShortName ? ` ${(pm as any).siteShortName}` : '';
        const displayTitle = hasNameField
            ? `${pm!.name}${(pm as any)?.honorific || ''}${site}` || pm?.title || '不明な案件'
            : pm?.title || '不明な案件';

        return {
            id: a.id,
            title: displayTitle,
            name: hasNameField ? pm!.name : undefined,
            honorific: hasNameField ? (pm as any)?.honorific : undefined,
            constructionSuffixId: (pm as any)?.constructionSuffixId,
            siteShortName: (pm as any)?.siteShortName ?? null,
            startDate: a.date,
            category: 'construction' as const,
            color,
            description: a.projectMaster?.description,
            location: a.projectMaster?.location,
            customer: a.projectMaster?.customerShortName || a.projectMaster?.customerName,
            workers: a.workers,
            memberCount: a.memberCount,
            estimatedHours: a.estimatedHours ?? 8.0,
            trucks: a.vehicles,
            tools: a.tools,
            remarks: a.remarks || '',
            dispatchRemark: a.dispatchRemark,
            constructionType: constructionType as 'assembly' | 'demolition' | 'other',
            constructionContent: a.projectMaster?.constructionContent,
            assignedEmployeeId: a.assignedEmployeeId,
            sortOrder: a.sortOrder,
            vehicles: a.vehicles,
            meetingTime: a.meetingTime,
            projectMasterId: a.projectMasterId,
            assignmentId: a.id,
            confirmedWorkerIds: a.confirmedWorkerIds,
            confirmedVehicleIds: a.confirmedVehicleIds,
            confirmedToolIds: a.confirmedToolIds,
            isDispatchConfirmed: a.isDispatchConfirmed,
            dateStatus: a.dateStatus ?? 'confirmed',
            confirmDueDate: a.confirmDueDate ?? null,
            createdBy: a.projectMaster?.createdBy,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            workStartedAt: a.workStartedAt ?? null,
            workEndedAt: a.workEndedAt ?? null,
        };
    }), [assignments, constructionTypes]);

    return {
        projects,
        isLoading,
        isInitialized,
        addProject,
        updateProject,
        updateProjects,
        demoteToFloating,
        deleteProject,
        restoreAssignment,
        restoreDeletedAssignment,
        getProjectById,
        getCalendarEvents,
        refreshProjects,
        fetchForDateRange,
        forceRefreshRange,
    };
}
