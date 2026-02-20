'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendarStore } from '@/stores/calendarStore';
import { Project, CalendarEvent, DEFAULT_CONSTRUCTION_TYPE_COLORS } from '@/types/calendar';
import { useMasterStore } from '@/stores/masterStore';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Re-export types for backward compatibility
export type { Project, CalendarEvent, ProjectAssignment, ProjectMaster } from '@/types/calendar';

// Re-export ConflictUpdateError for use in components
export { ConflictUpdateError } from '@/stores/calendarStore';

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
    const deleteProjectStore = useCalendarStore((state) => state.deleteProject);
    const getProjectByIdStore = useCalendarStore((state) => state.getProjectById);
    const getCalendarEventsStore = useCalendarStore((state) => state.getCalendarEvents);
    const fetchCellRemarksStore = useCalendarStore((state) => state.fetchCellRemarks);
    const upsertAssignmentStore = useCalendarStore((state) => state.upsertAssignment);
    const removeAssignmentByIdStore = useCalendarStore((state) => state.removeAssignmentById);
    const updateProjectMasterInAssignmentsStore = useCalendarStore((state) => state.updateProjectMasterInAssignments);

    // Use ref for date range to avoid callback recreation
    const currentDateRangeRef = useRef<{ start: string; end: string } | null>(null);

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

    // Supabase Realtime broadcast channel: 別デバイスへの即時通知用
    const syncChannelRef = useRef<RealtimeChannel | null>(null);

    // Reset state when unauthenticated
    useEffect(() => {
        if (status === 'unauthenticated') {
            currentDateRangeRef.current = null;
        }
    }, [status]);

    // Fetch for a specific date range
    const fetchForDateRange = useCallback(async (startDate: Date, endDate: Date) => {
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        // Skip if same range is already loaded
        const currentRange = currentDateRangeRef.current;
        if (currentRange?.start === startStr && currentRange?.end === endStr) {
            return;
        }

        currentDateRangeRef.current = { start: startStr, end: endStr };
        await fetchAssignmentsStore(startStr, endStr);

        // Fetch cell remarks if not initialized
        // Note: Currently fetching all remarks. In the future, this should be filtered by date range.
        if (!useCalendarStore.getState().cellRemarksInitialized) {
            fetchCellRemarksStore();
        }
    }, [fetchAssignmentsStore, fetchCellRemarksStore]);

    // 単一配置をAPIから取得してstoreに差し込む（Realtime incremental sync用）
    const fetchAndUpsertAssignment = useCallback(async (id: string) => {
        try {
            const response = await fetch(`/api/assignments/${id}`);
            if (!response.ok) return;
            const data = await response.json();
            const assignment = {
                ...data,
                date: new Date(data.date),
                createdAt: new Date(data.createdAt),
                updatedAt: new Date(data.updatedAt),
                projectMaster: data.projectMaster ? {
                    ...data.projectMaster,
                    createdAt: new Date(data.projectMaster.createdAt),
                    updatedAt: new Date(data.projectMaster.updatedAt),
                } : undefined,
            };
            // 現在の表示日付範囲内のみstoreに追加
            const range = currentDateRangeRef.current;
            if (range) {
                const assignmentDate = assignment.date.toISOString().split('T')[0];
                if (assignmentDate >= range.start && assignmentDate <= range.end) {
                    upsertAssignmentStore(assignment);
                }
            } else {
                upsertAssignmentStore(assignment);
            }
        } catch (error) {
            console.error('Failed to fetch assignment for realtime sync:', error);
        }
    }, [upsertAssignmentStore]);

    // Supabase Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: RealtimeChannel | null = null;

        const setupRealtime = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                channel = supabase
                    .channel('project_assignments_changes_zustand')
                    // ProjectAssignment: INSERT → 1件だけ取得してupsert
                    .on(
                        'postgres_changes',
                        { event: 'INSERT', schema: 'public', table: 'ProjectAssignment' },
                        (payload) => {
                            if (!isUpdatingRef.current) {
                                fetchAndUpsertAssignment(payload.new.id as string);
                            }
                        }
                    )
                    // ProjectAssignment: UPDATE → 1件だけ取得してupsert
                    .on(
                        'postgres_changes',
                        { event: 'UPDATE', schema: 'public', table: 'ProjectAssignment' },
                        (payload) => {
                            if (!isUpdatingRef.current) {
                                fetchAndUpsertAssignment(payload.new.id as string);
                            }
                        }
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
                    // ProjectMaster: UPDATE → 関連する配置のprojectMasterデータを更新
                    .on(
                        'postgres_changes',
                        { event: 'UPDATE', schema: 'public', table: 'ProjectMaster' },
                        async (payload) => {
                            if (!isUpdatingRef.current) {
                                try {
                                    const res = await fetch(`/api/project-masters/${payload.new.id}`);
                                    if (res.ok) {
                                        const pm = await res.json();
                                        updateProjectMasterInAssignmentsStore({
                                            ...pm,
                                            createdAt: new Date(pm.createdAt),
                                            updatedAt: new Date(pm.updatedAt),
                                        });
                                    }
                                } catch (error) {
                                    console.error('Failed to sync project master:', error);
                                }
                            }
                        }
                    )
                    // Broadcast: 別デバイスからの即時通知を受け取る（WAL処理をバイパス）
                    .on(
                        'broadcast',
                        { event: 'assignment_updated' },
                        ({ payload }) => {
                            if (!isUpdatingRef.current && payload?.id) {
                                fetchAndUpsertAssignment(payload.id as string);
                            }
                        }
                    )
                    .on(
                        'broadcast',
                        { event: 'assignments_batch_updated' },
                        ({ payload }) => {
                            if (!isUpdatingRef.current && Array.isArray(payload?.ids)) {
                                (payload.ids as string[]).forEach((assignmentId: string) => fetchAndUpsertAssignment(assignmentId));
                            }
                        }
                    )
                    .on(
                        'broadcast',
                        { event: 'assignment_deleted' },
                        ({ payload }) => {
                            if (!isUpdatingRef.current && payload?.id) {
                                removeAssignmentByIdStore(payload.id as string);
                            }
                        }
                    )
                    .subscribe();

                syncChannelRef.current = channel;
            } catch (error) {
                console.error('Failed to setup realtime:', error);
            }
        };

        setupRealtime();

        return () => {
            syncChannelRef.current = null;
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
    }, [status, fetchAndUpsertAssignment, removeAssignmentByIdStore, updateProjectMasterInAssignmentsStore]);

    // BroadcastChannel セットアップ（同一デバイスの別タブへ通知）
    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const ch = new BroadcastChannel('yusystem_assignments_v1');
        broadcastRef.current = ch;

        ch.addEventListener('message', (event) => {
            if (isUpdatingRef.current) return; // 自分が更新中なら無視
            const { type, id, ids } = event.data ?? {};
            if (type === 'assignment_updated' && id) {
                fetchAndUpsertAssignment(id);
            } else if (type === 'assignments_batch_updated' && Array.isArray(ids)) {
                ids.forEach((assignmentId: string) => fetchAndUpsertAssignment(assignmentId));
            } else if (type === 'assignment_deleted' && id) {
                removeAssignmentByIdStore(id);
            }
        });

        return () => {
            ch.close();
            broadcastRef.current = null;
        };
    }, [fetchAndUpsertAssignment, removeAssignmentByIdStore]);

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
            syncChannelRef.current?.send({
                type: 'broadcast',
                event: 'assignment_updated',
                payload: { id },
            });
        } finally {
            const tid = setTimeout(() => {
                isUpdatingRef.current = false;
                setIsUpdating(false);
                timeoutRefs.current = timeoutRefs.current.filter(t => t !== tid);
            }, 500);
            timeoutRefs.current.push(tid);
        }
    }, [updateProjectStore]);

    const updateProjects = useCallback(async (updates: Array<{ id: string; data: Partial<Project> }>) => {
        // リアルタイム購読がfetchを呼ばないよう、先にrefを更新
        isUpdatingRef.current = true;
        setIsUpdating(true);
        try {
            await updateProjectsStore(updates);
            const ids = updates.map(u => u.id);
            // 同一デバイスの別タブへ即時通知
            broadcastRef.current?.postMessage({ type: 'assignments_batch_updated', ids });
            // 別デバイスへ即時通知（Supabase Realtime broadcast）
            syncChannelRef.current?.send({
                type: 'broadcast',
                event: 'assignments_batch_updated',
                payload: { ids },
            });
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
        await deleteProjectStore(id);
        // 同一デバイスの別タブへ即時通知
        broadcastRef.current?.postMessage({ type: 'assignment_deleted', id });
        // 別デバイスへ即時通知（Supabase Realtime broadcast）
        syncChannelRef.current?.send({
            type: 'broadcast',
            event: 'assignment_deleted',
            payload: { id },
        });
    }, [deleteProjectStore]);

    const getProjectById = useCallback((id: string) => {
        return getProjectByIdStore(id);
    }, [getProjectByIdStore]);

    const getCalendarEvents = useCallback((): CalendarEvent[] => {
        return getCalendarEventsStore();
    }, [getCalendarEventsStore]);

    const refreshProjects = useCallback(async () => {
        currentDateRangeRef.current = null;
        await fetchAssignmentsStore();
    }, [fetchAssignmentsStore]);

    // ポーリング用: 指定範囲を強制再フェッチ（Realtime補完）
    const forceRefreshRange = useCallback(async (startDate: Date, endDate: Date) => {
        if (isUpdatingRef.current) return; // 自分が更新中なら跳ばす
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];
        currentDateRangeRef.current = null; // キャッシュをクリアして強制再フェッチ
        await fetchAssignmentsStore(startStr, endStr);
        currentDateRangeRef.current = { start: startStr, end: endStr };
    }, [fetchAssignmentsStore]);

    // Subscribe to assignments changes to trigger re-renders
    const assignments = useCalendarStore((state) => state.assignments);

    // マスターデータから工事種別を取得
    const constructionTypes = useMasterStore((state) => state.constructionTypes);

    // Get projects from store (now reactive because we subscribe to assignments)
    const projects = assignments.map((a) => {
        // 配置ごとのconstructionTypeを優先、なければProjectMasterから取得
        const constructionType = a.constructionType || a.projectMaster?.constructionType || 'other';
        // マスターデータから色を取得
        const masterType = constructionTypes.find(ct => ct.id === constructionType || ct.name === constructionType);
        const color = masterType?.color || DEFAULT_CONSTRUCTION_TYPE_COLORS[constructionType] || DEFAULT_CONSTRUCTION_TYPE_COLORS.other;

        return {
            id: a.id,
            title: a.projectMaster?.title || '不明な案件',
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
            remarks: a.remarks || a.projectMaster?.remarks,
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
            isDispatchConfirmed: a.isDispatchConfirmed,
            createdBy: a.projectMaster?.createdBy,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
        };
    });

    return {
        projects,
        isLoading,
        isInitialized,
        addProject,
        updateProject,
        updateProjects,
        deleteProject,
        getProjectById,
        getCalendarEvents,
        refreshProjects,
        fetchForDateRange,
        forceRefreshRange,
    };
}
