'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { ProjectMaster } from '@/types/calendar';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

interface ProjectMasterContextType {
    projectMasters: ProjectMaster[];
    isLoading: boolean;
    error: string | null;
    fetchProjectMasters: (search?: string, status?: string) => Promise<void>;
    createProjectMaster: (data: Omit<ProjectMaster, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ProjectMaster>;
    updateProjectMaster: (id: string, data: Partial<ProjectMaster>) => Promise<ProjectMaster>;
    deleteProjectMaster: (id: string) => Promise<void>;
    getProjectMasterById: (id: string) => ProjectMaster | undefined;
}

const ProjectMasterContext = createContext<ProjectMasterContextType | undefined>(undefined);

export function ProjectMasterProvider({ children }: { children: ReactNode }) {
    const [projectMasters, setProjectMasters] = useState<ProjectMaster[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Supabase Realtimeセットアップ
    useEffect(() => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            console.warn('[ProjectMaster Realtime] Supabase credentials not found');
            return;
        }

        const supabase = createSupabaseClient(supabaseUrl, supabaseKey);

        const channel = supabase
            .channel('project_masters_changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'ProjectMaster' },
                () => {
                    fetchProjectMasters();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchProjectMasters = useCallback(async (search?: string, status?: string) => {
        try {
            setIsLoading(true);
            setError(null);

            const params = new URLSearchParams();
            if (search) params.append('search', search);
            if (status) params.append('status', status);

            const url = `/api/project-masters${params.toString() ? `?${params}` : ''}`;
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error('案件マスターの取得に失敗しました');
            }

            const data = await res.json();

            // Date文字列をDateオブジェクトに変換
            const formatted = data.map((pm: ProjectMaster & { createdAt: string; updatedAt: string; assemblyDate?: string; demolitionDate?: string }) => ({
                ...pm,
                createdAt: new Date(pm.createdAt),
                updatedAt: new Date(pm.updatedAt),
                assemblyDate: pm.assemblyDate ? new Date(pm.assemblyDate) : undefined,
                demolitionDate: pm.demolitionDate ? new Date(pm.demolitionDate) : undefined,
            }));

            setProjectMasters(formatted);
        } catch (err) {
            console.error('Fetch project masters error:', err);
            setError(err instanceof Error ? err.message : '不明なエラー');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const createProjectMaster = useCallback(async (data: Omit<ProjectMaster, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProjectMaster> => {
        const res = await fetch('/api/project-masters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '案件マスターの作成に失敗しました');
        }

        const newPm = await res.json();
        const formatted = {
            ...newPm,
            createdAt: new Date(newPm.createdAt),
            updatedAt: new Date(newPm.updatedAt),
            assemblyDate: newPm.assemblyDate ? new Date(newPm.assemblyDate) : undefined,
            demolitionDate: newPm.demolitionDate ? new Date(newPm.demolitionDate) : undefined,
        };

        setProjectMasters(prev => [formatted, ...prev]);
        return formatted;
    }, []);

    const updateProjectMaster = useCallback(async (id: string, data: Partial<ProjectMaster>): Promise<ProjectMaster> => {
        const res = await fetch(`/api/project-masters/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '案件マスターの更新に失敗しました');
        }

        const updatedPm = await res.json();
        const formatted = {
            ...updatedPm,
            createdAt: new Date(updatedPm.createdAt),
            updatedAt: new Date(updatedPm.updatedAt),
            assemblyDate: updatedPm.assemblyDate ? new Date(updatedPm.assemblyDate) : undefined,
            demolitionDate: updatedPm.demolitionDate ? new Date(updatedPm.demolitionDate) : undefined,
        };

        setProjectMasters(prev => prev.map(pm => pm.id === id ? formatted : pm));
        return formatted;
    }, []);

    const deleteProjectMaster = useCallback(async (id: string): Promise<void> => {
        const res = await fetch(`/api/project-masters/${id}`, {
            method: 'DELETE',
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '案件マスターの削除に失敗しました');
        }

        setProjectMasters(prev => prev.filter(pm => pm.id !== id));
    }, []);

    const getProjectMasterById = useCallback((id: string): ProjectMaster | undefined => {
        return projectMasters.find(pm => pm.id === id);
    }, [projectMasters]);

    // 初回データ取得
    useEffect(() => {
        fetchProjectMasters();
    }, [fetchProjectMasters]);

    return (
        <ProjectMasterContext.Provider
            value={{
                projectMasters,
                isLoading,
                error,
                fetchProjectMasters,
                createProjectMaster,
                updateProjectMaster,
                deleteProjectMaster,
                getProjectMasterById,
            }}
        >
            {children}
        </ProjectMasterContext.Provider>
    );
}

export function useProjectMasters() {
    const context = useContext(ProjectMasterContext);
    if (context === undefined) {
        throw new Error('useProjectMasters must be used within a ProjectMasterProvider');
    }
    return context;
}
