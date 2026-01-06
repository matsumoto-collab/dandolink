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

    // Track if we're in the middle of a local update to skip realtime refresh
    const isLocalUpdate = useRef(false);

    // Fetch projects from API
    const fetchProjects = useCallback(async () => {
        try {
            const response = await fetch('/api/projects');
            if (response.ok) {
                const data = await response.json();
                const parsedProjects = data.map((project: any) => ({
                    ...project,
                    startDate: new Date(project.startDate),
                    endDate: project.endDate ? new Date(project.endDate) : undefined,
                    assemblyStartDate: project.assemblyStartDate ? new Date(project.assemblyStartDate) : undefined,
                    demolitionStartDate: project.demolitionStartDate ? new Date(project.demolitionStartDate) : undefined,
                    createdAt: new Date(project.createdAt),
                    updatedAt: new Date(project.updatedAt),
                }));
                setProjects(parsedProjects);
            }
        } catch (error) {
            console.error('Failed to fetch projects:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Load projects when authenticated
    useEffect(() => {
        if (status === 'authenticated') {
            fetchProjects();
        } else if (status === 'unauthenticated') {
            setProjects([]);
            setIsLoading(false);
        }
    }, [status, fetchProjects]);

    // Supabase Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: any = null;
        let debounceTimer: NodeJS.Timeout | null = null;

        const setupRealtime = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                channel = supabase
                    .channel('projects-realtime')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'Project' }, () => {
                        // Skip if we're in the middle of a local update
                        if (isLocalUpdate.current) return;

                        // Debounce to avoid multiple rapid fetches
                        if (debounceTimer) clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            fetchProjects();
                        }, 300);
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
        try {
            const response = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(projectData),
            });

            if (response.ok) {
                const newProject = await response.json();
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
                throw new Error(error.error || 'Failed to add project');
            }
        } catch (error) {
            console.error('Failed to add project:', error);
            throw error;
        }
    }, []);

    // Update a project with optimistic update
    const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
        // Set flag to prevent realtime from overwriting
        isLocalUpdate.current = true;

        // Optimistic update
        const previousProjects = [...projects];
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
                const parsedProject = {
                    ...updatedProject,
                    startDate: new Date(updatedProject.startDate),
                    endDate: updatedProject.endDate ? new Date(updatedProject.endDate) : undefined,
                    assemblyStartDate: updatedProject.assemblyStartDate ? new Date(updatedProject.assemblyStartDate) : undefined,
                    demolitionStartDate: updatedProject.demolitionStartDate ? new Date(updatedProject.demolitionStartDate) : undefined,
                    createdAt: new Date(updatedProject.createdAt),
                    updatedAt: new Date(updatedProject.updatedAt),
                };
                setProjects(prev => prev.map(p => p.id === id ? parsedProject : p));
            } else {
                // Rollback
                setProjects(previousProjects);
                const error = await response.json();
                throw new Error(error.error || 'Failed to update project');
            }
        } catch (error) {
            setProjects(previousProjects);
            console.error('Failed to update project:', error);
            throw error;
        } finally {
            // Allow realtime again after a delay
            setTimeout(() => { isLocalUpdate.current = false; }, 2000);
        }
    }, [projects]);

    // Update multiple projects
    const updateProjects = useCallback(async (updates: Array<{ id: string; data: Partial<Project> }>) => {
        isLocalUpdate.current = true;
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
            await fetchProjects();
        } catch (error) {
            console.error('Failed to update projects:', error);
            throw error;
        } finally {
            setTimeout(() => { isLocalUpdate.current = false; }, 2000);
        }
    }, [fetchProjects]);

    // Delete a project
    const deleteProject = useCallback(async (id: string) => {
        try {
            const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
            if (response.ok) {
                setProjects(prev => prev.filter(p => p.id !== id));
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete project');
            }
        } catch (error) {
            console.error('Failed to delete project:', error);
            throw error;
        }
    }, []);

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
