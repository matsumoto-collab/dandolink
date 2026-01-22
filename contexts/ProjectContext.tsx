'use client';

/**
 * @deprecated This context is deprecated. Use ProjectMasterContext and AssignmentContext instead.
 * This is a backward-compatible wrapper that maps the new Assignment-based system to the old Project API.
 */

import React, { createContext, useContext, useCallback, useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Project, CalendarEvent, CONSTRUCTION_TYPE_COLORS, ProjectAssignment, ProjectMaster } from '@/types/calendar';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface ProjectContextType {
    projects: Project[];
    isLoading: boolean;
    isInitialized: boolean;
    addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
    updateProjects: (updates: Array<{ id: string; data: Partial<Project> }>) => Promise<void>;
    deleteProject: (id: string) => Promise<void>;
    getProjectById: (id: string) => Project | undefined;
    getCalendarEvents: () => CalendarEvent[];
    refreshProjects: () => Promise<void>;
    fetchForDateRange: (startDate: Date, endDate: Date) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

// Convert Assignment to legacy Project format
function assignmentToProject(assignment: ProjectAssignment & { projectMaster?: ProjectMaster }): Project {
    const constructionType = assignment.projectMaster?.constructionType || 'other';
    const color = CONSTRUCTION_TYPE_COLORS[constructionType as keyof typeof CONSTRUCTION_TYPE_COLORS] || CONSTRUCTION_TYPE_COLORS.other;

    return {
        id: assignment.id,
        title: assignment.projectMaster?.title || '不明な案件',
        startDate: assignment.date,
        category: 'construction',
        color,
        description: assignment.projectMaster?.description,
        location: assignment.projectMaster?.location,
        customer: assignment.projectMaster?.customerName,
        workers: assignment.workers,
        trucks: assignment.vehicles,
        remarks: assignment.remarks || assignment.projectMaster?.remarks,
        constructionType: constructionType as 'assembly' | 'demolition' | 'other',
        assignedEmployeeId: assignment.assignedEmployeeId,
        sortOrder: assignment.sortOrder,
        vehicles: assignment.vehicles,
        meetingTime: assignment.meetingTime,
        projectMasterId: assignment.projectMasterId,
        assignmentId: assignment.id,
        confirmedWorkerIds: assignment.confirmedWorkerIds,
        confirmedVehicleIds: assignment.confirmedVehicleIds,
        isDispatchConfirmed: assignment.isDispatchConfirmed,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
    };
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const [assignments, setAssignments] = useState<(ProjectAssignment & { projectMaster?: ProjectMaster })[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // Fetch assignments from API with optional date range
    const fetchAssignments = useCallback(async (startDate?: string, endDate?: string) => {
        try {
            setIsLoading(true);
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            const url = `/api/assignments${params.toString() ? `?${params}` : ''}`;

            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                const parsed = data.map((a: ProjectAssignment & { date: string; createdAt: string; updatedAt: string; projectMaster?: ProjectMaster & { createdAt: string; updatedAt: string } }) => ({
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
                setAssignments(parsed);
                setIsInitialized(true);
            }
        } catch (error) {
            console.error('Failed to fetch assignments:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Fetch for a specific date range (called by WeeklyCalendar)
    // Use ref to avoid callback recreation on every render
    const currentDateRangeRef = React.useRef<{ start: string; end: string } | null>(null);

    const fetchForDateRange = useCallback(async (startDate: Date, endDate: Date) => {
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        // Skip if same range is already loaded
        const currentRange = currentDateRangeRef.current;
        if (currentRange?.start === startStr && currentRange?.end === endStr) {
            return;
        }

        currentDateRangeRef.current = { start: startStr, end: endStr };
        await fetchAssignments(startStr, endStr);
    }, [fetchAssignments]);

    // Reset state when unauthenticated
    useEffect(() => {
        if (status === 'unauthenticated') {
            setAssignments([]);
            setIsLoading(false);
            setIsInitialized(false);
            currentDateRangeRef.current = null;
        }
    }, [status]);

    // Supabase Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated') return;

        let channel: RealtimeChannel | null = null;

        const setupRealtime = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');
                channel = supabase
                    .channel('project_assignments_changes')
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'ProjectAssignment' },
                        () => {
                            fetchAssignments();
                        }
                    )
                    .on(
                        'postgres_changes',
                        { event: '*', schema: 'public', table: 'ProjectMaster' },
                        () => {
                            fetchAssignments();
                        }
                    )
                    .subscribe();
            } catch (error) {
                console.error('Failed to setup realtime:', error);
            }
        };

        setupRealtime();

        return () => {
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channelToRemove);
                });
            }
        };
    }, [status, fetchAssignments]);

    // Convert assignments to legacy Project format
    const projects = useMemo(() => {
        return assignments.map(assignmentToProject);
    }, [assignments]);

    // Add project (creates both ProjectMaster and Assignment)
    const addProject = useCallback(async (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        try {
            let projectMasterId: string;

            // If projectMasterId is already provided (from ProjectMasterSearchModal), use it directly
            if (project.projectMasterId) {
                projectMasterId = project.projectMasterId;
                // 工事種別が指定されている場合はProjectMasterを更新
                if (project.constructionType) {
                    await fetch(`/api/project-masters/${project.projectMasterId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            constructionType: project.constructionType,
                        }),
                    });
                }
            } else {
                // Check if project master exists by title or create new one
                const mastersRes = await fetch(`/api/project-masters?search=${encodeURIComponent(project.title)}`);
                const masters = await mastersRes.json();
                const existing = masters.find((m: ProjectMaster) => m.title === project.title);

                if (existing) {
                    projectMasterId = existing.id;
                    // 工事種別が変更されている場合はProjectMasterを更新
                    if (project.constructionType && existing.constructionType !== project.constructionType) {
                        await fetch(`/api/project-masters/${existing.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                constructionType: project.constructionType,
                            }),
                        });
                    }
                } else {
                    // Create new project master
                    const createMasterRes = await fetch('/api/project-masters', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title: project.title,
                            customerName: project.customer,
                            constructionType: project.constructionType || 'other',
                            location: project.location,
                            description: project.description,
                            remarks: project.remarks,
                        }),
                    });
                    const newMaster = await createMasterRes.json();
                    projectMasterId = newMaster.id;

                    // Dispatch custom event to notify ProjectMasterContext
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('projectMasterCreated', { detail: newMaster }));
                    }
                }
            }

            // Create assignment
            await fetch('/api/assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectMasterId,
                    assignedEmployeeId: project.assignedEmployeeId,
                    date: project.startDate instanceof Date ? project.startDate.toISOString() : project.startDate,
                    memberCount: project.workers?.length || 0,
                    workers: project.workers,
                    vehicles: project.vehicles,
                    meetingTime: project.meetingTime,
                    sortOrder: project.sortOrder || 0,
                    remarks: project.remarks,
                }),
            });

            // キャッシュをクリアして最新データを強制取得
            currentDateRangeRef.current = null;
            await fetchAssignments();
        } catch (error) {
            console.error('Failed to add project:', error);
            throw error;
        }
    }, [fetchAssignments]);

    // Update project (updates assignment)
    const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
        // Store previous state for rollback
        const previousAssignments = [...assignments];

        // Find the assignment to get projectMasterId
        const assignment = assignments.find(a => a.id === id);

        // Optimistic update BEFORE API call for smooth UI
        setAssignments(prev => prev.map(a =>
            a.id === id
                ? { ...a, ...updates, date: updates.startDate || a.date }
                : a
        ));

        try {
            // 工事種別が変更されている場合はProjectMasterを更新
            if (updates.constructionType && assignment?.projectMasterId) {
                await fetch(`/api/project-masters/${assignment.projectMasterId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        constructionType: updates.constructionType,
                    }),
                });
            }

            await fetch(`/api/assignments/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assignedEmployeeId: updates.assignedEmployeeId,
                    date: updates.startDate instanceof Date ? updates.startDate.toISOString() : updates.startDate,
                    memberCount: updates.workers?.length,
                    workers: updates.workers,
                    vehicles: updates.vehicles,
                    meetingTime: updates.meetingTime,
                    sortOrder: updates.sortOrder,
                    remarks: updates.remarks,
                    isDispatchConfirmed: updates.isDispatchConfirmed,
                    confirmedWorkerIds: updates.confirmedWorkerIds,
                    confirmedVehicleIds: updates.confirmedVehicleIds,
                }),
            });

            // キャッシュをクリアして最新データを強制取得
            currentDateRangeRef.current = null;
            await fetchAssignments();
        } catch (error) {
            // Rollback on error
            setAssignments(previousAssignments);
            console.error('Failed to update project:', error);
            throw error;
        }
    }, [assignments, fetchAssignments]);

    // Batch update projects
    const updateProjects = useCallback(async (updates: Array<{ id: string; data: Partial<Project> }>) => {
        // Store previous state for rollback
        const previousAssignments = [...assignments];

        // Optimistic update BEFORE API call for smooth UI
        setAssignments(prev => {
            const newAssignments = [...prev];
            updates.forEach(update => {
                const index = newAssignments.findIndex(a => a.id === update.id);
                if (index !== -1) {
                    newAssignments[index] = {
                        ...newAssignments[index],
                        ...update.data,
                        date: update.data.startDate || newAssignments[index].date,
                    };
                }
            });
            return newAssignments;
        });

        try {
            await fetch('/api/assignments/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    updates: updates.map(u => ({
                        id: u.id,
                        data: {
                            assignedEmployeeId: u.data.assignedEmployeeId,
                            date: u.data.startDate instanceof Date ? u.data.startDate.toISOString() : u.data.startDate,
                            sortOrder: u.data.sortOrder,
                            workers: u.data.workers,
                            vehicles: u.data.vehicles,
                            meetingTime: u.data.meetingTime,
                            remarks: u.data.remarks,
                        },
                    })),
                }),
            });
        } catch (error) {
            // Rollback on error
            setAssignments(previousAssignments);
            console.error('Failed to batch update projects:', error);
            throw error;
        }
    }, [assignments]);

    // Delete project (deletes assignment)
    const deleteProject = useCallback(async (id: string) => {
        try {
            await fetch(`/api/assignments/${id}`, {
                method: 'DELETE',
            });

            setAssignments(prev => prev.filter(a => a.id !== id));
        } catch (error) {
            console.error('Failed to delete project:', error);
            throw error;
        }
    }, []);

    const getProjectById = useCallback((id: string) => {
        const assignment = assignments.find(a => a.id === id);
        return assignment ? assignmentToProject(assignment) : undefined;
    }, [assignments]);

    const getCalendarEvents = useCallback((): CalendarEvent[] => {
        return projects;
    }, [projects]);

    const refreshProjects = useCallback(async () => {
        // キャッシュをクリアして最新データを強制取得
        currentDateRangeRef.current = null;
        await fetchAssignments();
    }, [fetchAssignments]);

    return (
        <ProjectContext.Provider
            value={{
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
