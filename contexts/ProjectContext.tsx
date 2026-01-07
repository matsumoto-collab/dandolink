'use client';

import React, { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react';
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

    // Track the last update timestamp to prevent realtime from overwriting recent changes
    const lastLocalUpdateTime = useRef<number>(0);
    // Track IDs being updated locally
    const pendingUpdateIds = useRef<Set<string>>(new Set());
    // Minimum time to wait before allowing realtime updates (5 seconds)
    const REALTIME_BLOCK_DURATION = 5000;

    // Parse project from API response
    const parseProject = useCallback((project: any): Project => ({
        ...project,
        startDate: new Date(project.startDate),
        endDate: project.endDate ? new Date(project.endDate) : undefined,
        assemblyStartDate: project.assemblyStartDate ? new Date(project.assemblyStartDate) : undefined,
        demolitionStartDate: project.demolitionStartDate ? new Date(project.demolitionStartDate) : undefined,
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
    }), []);

    // Fetch projects from API
    const fetchProjects = useCallback(async () => {
        try {
            const response = await fetch('/api/projects');
            if (response.ok) {
                const data = await response.json();
                const parsedProjects = data.map(parseProject);

                // Only update if not in the middle of local updates
                const now = Date.now();
                if (now - lastLocalUpdateTime.current > REALTIME_BLOCK_DURATION && pendingUpdateIds.current.size === 0) {
                    setProjects(parsedProjects);
                }
            }
        } catch (error) {
            console.error('Failed to fetch projects:', error);
        } finally {
            setIsLoading(false);
        }
    }, [parseProject]);

    // Initial load when authenticated
    useEffect(() => {
        if (status === 'authenticated') {
            // Force initial load regardless of timing
            const doInitialFetch = async () => {
                try {
                    const response = await fetch('/api/projects');
                    if (response.ok) {
                        const data = await response.json();
                        const parsedProjects = data.map(parseProject);
                        setProjects(parsedProjects);
                    }
                } catch (error) {
                    console.error('Failed to fetch projects:', error);
                } finally {
                    setIsLoading(false);
                }
            };
            doInitialFetch();
        } else if (status === 'unauthenticated') {
            setProjects([]);
            setIsLoading(false);
        }
    }, [status, parseProject]);

    // Supabase Realtime subscription - only for OTHER users' changes
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: any = null;
        let debounceTimer: NodeJS.Timeout | null = null;

        const setupRealtime = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                channel = supabase
                    .channel('projects-realtime-v2')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'Project' }, () => {
                        // Check if we should skip this update
                        const now = Date.now();
                        const timeSinceLastUpdate = now - lastLocalUpdateTime.current;

                        // Skip if within protection period or having pending updates
                        if (timeSinceLastUpdate < REALTIME_BLOCK_DURATION || pendingUpdateIds.current.size > 0) {
                            return;
                        }

                        // Debounce fetches
                        if (debounceTimer) clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            fetchProjects();
                        }, 500);
                    })
                    .subscribe();
            } catch (error) {
                console.error('Failed to setup realtime:', error);
            }
        };

        setupRealtime();

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            if (channel) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channel);
                });
            }
        };
    }, [status, fetchProjects]);

    // Add a new project
    const addProject = useCallback(async (projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        lastLocalUpdateTime.current = Date.now();

        try {
            const response = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(projectData),
            });

            if (response.ok) {
                const newProject = await response.json();
                const parsedProject = parseProject(newProject);
                setProjects(prev => [...prev, parsedProject]);
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add project');
            }
        } catch (error) {
            console.error('Failed to add project:', error);
            throw error;
        }
    }, [parseProject]);

    // Update a project with optimistic update
    const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
        // Mark as pending and set timestamp
        pendingUpdateIds.current.add(id);
        lastLocalUpdateTime.current = Date.now();

        // Store previous state for rollback
        const previousProjects = projects;

        // Optimistic update
        setProjects(prev => prev.map(p =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date() } : p
        ));

        try {
            const response = await fetch(`/api/projects/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });

            if (response.ok) {
                const updatedProject = await response.json();
                const parsedProject = parseProject(updatedProject);
                setProjects(prev => prev.map(p => p.id === id ? parsedProject : p));
            } else {
                // Rollback on error
                setProjects(previousProjects);
                const error = await response.json();
                throw new Error(error.error || 'Failed to update project');
            }
        } catch (error) {
            // Rollback on error
            setProjects(previousProjects);
            console.error('Failed to update project:', error);
            throw error;
        } finally {
            // Clear pending after a longer delay to ensure realtime events have passed
            setTimeout(() => {
                pendingUpdateIds.current.delete(id);
            }, REALTIME_BLOCK_DURATION);
        }
    }, [projects, parseProject]);

    // Update multiple projects
    const updateProjects = useCallback(async (updates: Array<{ id: string; data: Partial<Project> }>) => {
        lastLocalUpdateTime.current = Date.now();
        updates.forEach(u => pendingUpdateIds.current.add(u.id));

        try {
            await Promise.all(
                updates.map(({ id, data }) =>
                    fetch(`/api/projects/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data),
                    })
                )
            );
            // Fetch fresh data after batch update
            const response = await fetch('/api/projects');
            if (response.ok) {
                const data = await response.json();
                setProjects(data.map(parseProject));
            }
        } catch (error) {
            console.error('Failed to update projects:', error);
            throw error;
        } finally {
            setTimeout(() => {
                updates.forEach(u => pendingUpdateIds.current.delete(u.id));
            }, REALTIME_BLOCK_DURATION);
        }
    }, [parseProject]);

    // Delete a project
    const deleteProject = useCallback(async (id: string) => {
        lastLocalUpdateTime.current = Date.now();
        pendingUpdateIds.current.add(id);

        // Optimistic delete
        const previousProjects = projects;
        setProjects(prev => prev.filter(p => p.id !== id));

        try {
            const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                setProjects(previousProjects);
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete project');
            }
        } catch (error) {
            setProjects(previousProjects);
            console.error('Failed to delete project:', error);
            throw error;
        } finally {
            setTimeout(() => {
                pendingUpdateIds.current.delete(id);
            }, REALTIME_BLOCK_DURATION);
        }
    }, [projects]);

    // Get project by ID
    const getProjectById = useCallback((id: string) => {
        return projects.find(p => p.id === id);
    }, [projects]);

    // Convert projects to calendar events
    const getCalendarEvents = useCallback((): CalendarEvent[] => {
        const events: CalendarEvent[] = [];

        projects.forEach(project => {
            if (project.assemblyStartDate && project.assemblyDuration) {
                const assemblyEnd = new Date(project.assemblyStartDate);
                assemblyEnd.setDate(assemblyEnd.getDate() + project.assemblyDuration - 1);

                events.push({
                    id: `${project.id}-assembly`,
                    title: project.title,
                    startDate: project.assemblyStartDate,
                    endDate: assemblyEnd,
                    category: 'construction',
                    color: CONSTRUCTION_TYPE_COLORS.assembly,
                    constructionType: 'assembly',
                    assignedEmployeeId: project.assignedEmployeeId,
                    customer: project.customer,
                    location: project.location,
                    description: project.description,
                    workers: project.workers,
                    trucks: project.trucks || project.vehicles,
                    remarks: project.remarks,
                    sortOrder: project.sortOrder,
                });
            }

            if (project.demolitionStartDate && project.demolitionDuration) {
                const demolitionEnd = new Date(project.demolitionStartDate);
                demolitionEnd.setDate(demolitionEnd.getDate() + project.demolitionDuration - 1);

                events.push({
                    id: `${project.id}-demolition`,
                    title: project.title,
                    startDate: project.demolitionStartDate,
                    endDate: demolitionEnd,
                    category: 'construction',
                    color: CONSTRUCTION_TYPE_COLORS.demolition,
                    constructionType: 'demolition',
                    assignedEmployeeId: project.assignedEmployeeId,
                    customer: project.customer,
                    location: project.location,
                    description: project.description,
                    workers: project.workers,
                    trucks: project.trucks || project.vehicles,
                    remarks: project.remarks,
                    sortOrder: project.sortOrder,
                });
            }

            if (!project.assemblyStartDate && !project.demolitionStartDate) {
                events.push({
                    id: project.id,
                    title: project.title,
                    startDate: project.startDate,
                    endDate: project.endDate,
                    category: 'other',
                    color: CONSTRUCTION_TYPE_COLORS.other,
                    constructionType: 'other',
                    assignedEmployeeId: project.assignedEmployeeId,
                    customer: project.customer,
                    location: project.location,
                    description: project.description,
                    workers: project.workers,
                    trucks: project.trucks || project.vehicles,
                    remarks: project.remarks,
                    sortOrder: project.sortOrder,
                });
            }
        });

        return events;
    }, [projects]);

    // Force refresh - bypasses protection
    const forceRefreshProjects = useCallback(async () => {
        try {
            const response = await fetch('/api/projects');
            if (response.ok) {
                const data = await response.json();
                setProjects(data.map(parseProject));
            }
        } catch (error) {
            console.error('Failed to refresh projects:', error);
        }
    }, [parseProject]);

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
                refreshProjects: forceRefreshProjects,
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
