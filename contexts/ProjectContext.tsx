'use client';

import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Project, CalendarEvent, CONSTRUCTION_TYPE_COLORS } from '@/types/calendar';

interface ProjectContextType {
    projects: Project[];
    isLoading: boolean;
    addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
    updateProjects: (updates: Array<{ id: string; data: Partial<Project> }>) => Promise<void>;
    deleteProject: (id: string) => Promise<void>;
    getProjectById: (id: string) => Project | undefined;
    getCalendarEvents: () => CalendarEvent[];
    refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch projects from API
    const fetchProjects = useCallback(async () => {
        // Wait for session to be determined
        if (status === 'loading') {
            return; // Don't set isLoading to false yet
        }

        // If not authenticated, clear projects
        if (status !== 'authenticated') {
            setProjects([]);
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/projects');
            if (response.ok) {
                const data = await response.json();
                // Convert date strings to Date objects
                const parsedProjects = data.map((project: any) => ({
                    ...project,
                    startDate: new Date(project.startDate),
                    endDate: project.endDate ? new Date(project.endDate) : undefined,
                    assemblyStartDate: project.assemblyStartDate ? new Date(project.assemblyStartDate) : undefined,
                    demolitionStartDate: project.demolitionStartDate ? new Date(project.demolitionStartDate) : undefined,
                    createdAt: new Date(project.createdAt),
                    updatedAt: new Date(project.updatedAt),
                }));

                // Always update state with fresh data
                setProjects(parsedProjects);
            }
        } catch (error) {
            console.error('Failed to fetch projects:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    // Load projects on mount and when session changes
    useEffect(() => {
        if (status !== 'loading') {
            fetchProjects();
        }
    }, [fetchProjects, status]);

    // Supabase Realtime subscription for instant updates
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: ReturnType<typeof import('@/lib/supabase').supabase.channel> | null = null;
        let isSubscribed = true;

        const setupRealtimeSubscription = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');

                if (!isSubscribed) return;

                channel = supabase
                    .channel('projects-realtime')
                    .on(
                        'postgres_changes',
                        {
                            event: '*', // Listen to INSERT, UPDATE, DELETE
                            schema: 'public',
                            table: 'Project',
                        },
                        (payload) => {
                            console.log('[Realtime] Project changed:', payload.eventType, payload);
                            // Refresh data when changes occur from other clients
                            fetchProjects();
                        }
                    )
                    .subscribe((status) => {
                        console.log('[Realtime] Subscription status:', status);
                    });
            } catch (error) {
                console.error('[Realtime] Failed to setup subscription:', error);
            }
        };

        setupRealtimeSubscription();

        // Cleanup function
        return () => {
            isSubscribed = false;
            if (channel) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channel!);
                    console.log('[Realtime] Channel removed');
                });
            }
        };
    }, [status, fetchProjects]);

    // Add project
    const addProject = useCallback(async (projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        try {
            const response = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(projectData),
            });

            if (response.ok) {
                const newProject = await response.json();
                // Convert date strings to Date objects
                const parsedProject = {
                    ...newProject,
                    startDate: new Date(newProject.startDate),
                    endDate: newProject.endDate ? new Date(newProject.endDate) : undefined,
                    assemblyStartDate: newProject.assemblyStartDate ? new Date(newProject.assemblyStartDate) : undefined,
                    demolitionStartDate: newProject.demolitionStartDate ? new Date(newProject.demolitionStartDate) : undefined,
                    createdAt: new Date(newProject.createdAt),
                    updatedAt: new Date(newProject.updatedAt),
                };
                setProjects(prev => [...prev, parsedProject]);
            } else {
                const error = await response.json();
                throw new Error(error.error || 'プロジェクトの追加に失敗しました');
            }
        } catch (error) {
            console.error('Failed to add project:', error);
            throw error;
        }
    }, []);

    // Update project
    const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
        // Store the original project for potential rollback
        const originalProject = projects.find(p => p.id === id);

        try {
            // Optimistically update local state first for smooth UI
            setProjects(prev => prev.map(p => {
                if (p.id === id) {
                    return {
                        ...p,
                        ...updates,
                        updatedAt: new Date(),
                    };
                }
                return p;
            }));

            // Send update to server
            const response = await fetch(`/api/projects/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });

            if (response.ok) {
                const updatedProject = await response.json();
                // Convert date strings to Date objects
                const parsedProject = {
                    ...updatedProject,
                    startDate: new Date(updatedProject.startDate),
                    endDate: updatedProject.endDate ? new Date(updatedProject.endDate) : undefined,
                    assemblyStartDate: updatedProject.assemblyStartDate ? new Date(updatedProject.assemblyStartDate) : undefined,
                    demolitionStartDate: updatedProject.demolitionStartDate ? new Date(updatedProject.demolitionStartDate) : undefined,
                    createdAt: new Date(updatedProject.createdAt),
                    updatedAt: new Date(updatedProject.updatedAt),
                };
                // Update with server response to ensure consistency
                setProjects(prev => prev.map(p => p.id === id ? parsedProject : p));
            } else {
                const error = await response.json();
                // Rollback on error
                if (originalProject) {
                    setProjects(prev => prev.map(p => p.id === id ? originalProject : p));
                }
                throw new Error(error.error || 'プロジェクトの更新に失敗しました');
            }
        } catch (error) {
            console.error('Failed to update project:', error);
            // Rollback on error
            if (originalProject) {
                setProjects(prev => prev.map(p => p.id === id ? originalProject : p));
            }
            throw error;
        }
    }, [projects]);

    // Batch update projects
    const updateProjects = useCallback(async (updates: Array<{ id: string; data: Partial<Project> }>) => {
        try {
            // Optimistically update local state first for smooth UI
            setProjects(prev => {
                const updatedProjects = [...prev];
                updates.forEach(update => {
                    const index = updatedProjects.findIndex(p => p.id === update.id);
                    if (index !== -1) {
                        updatedProjects[index] = {
                            ...updatedProjects[index],
                            ...update.data,
                            updatedAt: new Date(),
                        };
                    }
                });
                return updatedProjects;
            });

            // Send update to server
            const response = await fetch('/api/projects/batch', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates }),
            });

            if (!response.ok) {
                const error = await response.json();
                // Revert on error
                await fetchProjects();
                throw new Error(error.error || 'プロジェクトの一括更新に失敗しました');
            }
        } catch (error) {
            console.error('Failed to batch update projects:', error);
            throw error;
        }
    }, [fetchProjects]);

    // Delete project
    const deleteProject = useCallback(async (id: string) => {
        try {
            const response = await fetch(`/api/projects/${id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                setProjects(prev => prev.filter(p => p.id !== id));
            } else {
                const error = await response.json();
                throw new Error(error.error || 'プロジェクトの削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete project:', error);
            throw error;
        }
    }, []);

    // Get project by ID
    const getProjectById = useCallback((id: string) => {
        return projects.find(project => project.id === id);
    }, [projects]);

    // Convert projects to calendar events
    const getCalendarEvents = useCallback((): CalendarEvent[] => {
        const events: CalendarEvent[] = [];

        projects.forEach(project => {
            // New structure: workSchedules
            if (project.workSchedules && project.workSchedules.length > 0) {
                project.workSchedules.forEach(schedule => {
                    schedule.dailySchedules.forEach((daily, _index) => {
                        const dateKey = daily.date.toISOString().split('T')[0];
                        events.push({
                            ...project,
                            id: `${project.id}-${schedule.type}-${dateKey}`,
                            startDate: daily.date,
                            endDate: daily.date,
                            constructionType: schedule.type,
                            color: CONSTRUCTION_TYPE_COLORS[schedule.type],
                            assignedEmployeeId: daily.assignedEmployeeId,
                            workers: daily.workers,
                            trucks: daily.trucks,
                            remarks: daily.remarks,
                            sortOrder: daily.sortOrder,
                        });
                    });
                });
            } else {
                // Backward compatibility: existing assemblyStartDate/demolitionStartDate
                // Assembly event
                if (project.assemblyStartDate) {
                    events.push({
                        ...project,
                        id: `${project.id}-assembly`,
                        startDate: project.assemblyStartDate,
                        endDate: project.assemblyEndDate,
                        constructionType: 'assembly',
                        color: CONSTRUCTION_TYPE_COLORS.assembly,
                    });
                }

                // Demolition event
                if (project.demolitionStartDate) {
                    events.push({
                        ...project,
                        id: `${project.id}-demolition`,
                        startDate: project.demolitionStartDate,
                        endDate: project.demolitionEndDate,
                        constructionType: 'demolition',
                        color: CONSTRUCTION_TYPE_COLORS.demolition,
                    });
                }

                // Backward compatibility: use constructionType if no assembly/demolition dates
                if (!project.assemblyStartDate && !project.demolitionStartDate && project.constructionType) {
                    events.push({
                        ...project,
                        color: CONSTRUCTION_TYPE_COLORS[project.constructionType],
                    });
                }
            }
        });

        return events;
    }, [projects]);

    return (
        <ProjectContext.Provider
            value={{
                projects,
                isLoading,
                addProject,
                updateProject,
                updateProjects,
                deleteProject,
                getProjectById,
                getCalendarEvents,
                refreshProjects: fetchProjects,
            }}
        >
            {children}
        </ProjectContext.Provider>
    );
}

export function useProjects() {
    const context = useContext(ProjectContext);
    if (context === undefined) {
        throw new Error('useProjects must be used within a ProjectProvider');
    }
    return context;
}
