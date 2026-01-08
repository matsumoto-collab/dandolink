'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { ProjectAssignment, AssignmentCalendarEvent, CONSTRUCTION_TYPE_COLORS } from '@/types/calendar';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

interface AssignmentContextType {
    assignments: ProjectAssignment[];
    isLoading: boolean;
    error: string | null;
    fetchAssignments: (startDate?: string, endDate?: string, assignedEmployeeId?: string) => Promise<void>;
    createAssignment: (data: Omit<ProjectAssignment, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ProjectAssignment>;
    updateAssignment: (id: string, data: Partial<ProjectAssignment>) => Promise<ProjectAssignment>;
    deleteAssignment: (id: string) => Promise<void>;
    updateAssignments: (updates: { id: string; data: Partial<ProjectAssignment> }[]) => Promise<void>;
    getAssignmentById: (id: string) => ProjectAssignment | undefined;
    // カレンダー表示用変換
    getCalendarEvents: () => AssignmentCalendarEvent[];
}

const AssignmentContext = createContext<AssignmentContextType | undefined>(undefined);

export function AssignmentProvider({ children }: { children: ReactNode }) {
    const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Supabase Realtimeセットアップ
    useEffect(() => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            console.warn('[Assignment Realtime] Supabase credentials not found');
            return;
        }

        const supabase = createSupabaseClient(supabaseUrl, supabaseKey);

        const channel = supabase
            .channel('assignments_changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'ProjectAssignment' },
                () => {
                    fetchAssignments();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchAssignments = useCallback(async (startDate?: string, endDate?: string, assignedEmployeeId?: string) => {
        try {
            setIsLoading(true);
            setError(null);

            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (assignedEmployeeId) params.append('assignedEmployeeId', assignedEmployeeId);

            const url = `/api/assignments${params.toString() ? `?${params}` : ''}`;
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error('配置の取得に失敗しました');
            }

            const data = await res.json();

            // Date文字列をDateオブジェクトに変換
            const formatted = data.map((a: ProjectAssignment & {
                date: string;
                createdAt: string;
                updatedAt: string;
                projectMaster?: { createdAt: string; updatedAt: string };
            }) => ({
                ...a,
                date: new Date(a.date),
                createdAt: new Date(a.createdAt),
                updatedAt: new Date(a.updatedAt),
                projectMaster: a.projectMaster ? {
                    ...a.projectMaster,
                    createdAt: new Date(a.projectMaster.createdAt),
                    updatedAt: new Date(a.projectMaster.updatedAt),
                } : undefined,
            }));

            setAssignments(formatted);
        } catch (err) {
            console.error('Fetch assignments error:', err);
            setError(err instanceof Error ? err.message : '不明なエラー');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const createAssignment = useCallback(async (data: Omit<ProjectAssignment, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProjectAssignment> => {
        const res = await fetch('/api/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...data,
                date: data.date instanceof Date ? data.date.toISOString() : data.date,
            }),
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '配置の作成に失敗しました');
        }

        const newAssignment = await res.json();
        const formatted = {
            ...newAssignment,
            date: new Date(newAssignment.date),
            createdAt: new Date(newAssignment.createdAt),
            updatedAt: new Date(newAssignment.updatedAt),
        };

        setAssignments(prev => [...prev, formatted]);
        return formatted;
    }, []);

    const updateAssignment = useCallback(async (id: string, data: Partial<ProjectAssignment>): Promise<ProjectAssignment> => {
        const res = await fetch(`/api/assignments/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...data,
                date: data.date instanceof Date ? data.date.toISOString() : data.date,
            }),
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '配置の更新に失敗しました');
        }

        const updated = await res.json();
        const formatted = {
            ...updated,
            date: new Date(updated.date),
            createdAt: new Date(updated.createdAt),
            updatedAt: new Date(updated.updatedAt),
        };

        setAssignments(prev => prev.map(a => a.id === id ? formatted : a));
        return formatted;
    }, []);

    const deleteAssignment = useCallback(async (id: string): Promise<void> => {
        const res = await fetch(`/api/assignments/${id}`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '配置の削除に失敗しました');
        }

        setAssignments(prev => prev.filter(a => a.id !== id));
    }, []);

    const updateAssignments = useCallback(async (updates: { id: string; data: Partial<ProjectAssignment> }[]): Promise<void> => {
        const res = await fetch('/api/assignments/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                updates: updates.map(u => ({
                    id: u.id,
                    data: {
                        ...u.data,
                        date: u.data.date instanceof Date ? u.data.date.toISOString() : u.data.date,
                    },
                })),
            }),
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '配置の一括更新に失敗しました');
        }

        // ローカル状態を更新
        setAssignments(prev => {
            const newAssignments = [...prev];
            updates.forEach(update => {
                const index = newAssignments.findIndex(a => a.id === update.id);
                if (index !== -1) {
                    newAssignments[index] = { ...newAssignments[index], ...update.data };
                }
            });
            return newAssignments;
        });
    }, []);

    const getAssignmentById = useCallback((id: string): ProjectAssignment | undefined => {
        return assignments.find(a => a.id === id);
    }, [assignments]);

    // カレンダー表示用に変換
    const getCalendarEvents = useCallback((): AssignmentCalendarEvent[] => {
        return assignments.map(a => {
            const constructionType = a.projectMaster?.constructionType || 'other';
            const color = CONSTRUCTION_TYPE_COLORS[constructionType as keyof typeof CONSTRUCTION_TYPE_COLORS] || CONSTRUCTION_TYPE_COLORS.other;

            return {
                id: a.id,
                title: a.projectMaster?.title || '不明な案件',
                startDate: a.date,
                endDate: a.date,
                category: 'construction' as const,
                color,
                description: a.projectMaster?.description,
                location: a.projectMaster?.location,
                customer: a.projectMaster?.customer,
                workers: a.workers,
                trucks: a.vehicles,
                remarks: a.remarks || a.projectMaster?.remarks,
                constructionType: constructionType as 'assembly' | 'demolition' | 'other',
                assignedEmployeeId: a.assignedEmployeeId,
                sortOrder: a.sortOrder,
                projectMasterId: a.projectMasterId,
                assignmentId: a.id,
                memberCount: a.memberCount,
                confirmedWorkerIds: a.confirmedWorkerIds,
                confirmedVehicleIds: a.confirmedVehicleIds,
                isDispatchConfirmed: a.isDispatchConfirmed,
            };
        });
    }, [assignments]);

    // 初回データ取得
    useEffect(() => {
        fetchAssignments();
    }, [fetchAssignments]);

    return (
        <AssignmentContext.Provider
            value={{
                assignments,
                isLoading,
                error,
                fetchAssignments,
                createAssignment,
                updateAssignment,
                deleteAssignment,
                updateAssignments,
                getAssignmentById,
                getCalendarEvents,
            }}
        >
            {children}
        </AssignmentContext.Provider>
    );
}

export function useAssignments() {
    const context = useContext(AssignmentContext);
    if (context === undefined) {
        throw new Error('useAssignments must be used within an AssignmentProvider');
    }
    return context;
}
