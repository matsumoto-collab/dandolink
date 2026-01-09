'use client';

/**
 * @deprecated This context is deprecated. Use ProjectMasterContext and AssignmentContext instead.
 * This is a backward-compatible wrapper that maps the new Assignment-based system to the old Project API.
 */

import React, { createContext, useContext, useCallback, useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Project, CalendarEvent, CONSTRUCTION_TYPE_COLORS, ProjectAssignment, ProjectMaster } from '@/types/calendar';

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
        customer: assignment.projectMaster?.customer,
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
    const [isLoading, setIsLoading] = useState(true);

    // Fetch assignments from API
    const fetchAssignments = useCallback(async () => {
        try {
            const response = await fetch('/api/assignments');
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
            }
        } catch (error) {
            console.error('Failed to fetch assignments:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Initial load when authenticated
    useEffect(() => {
        if (status === 'authenticated') {
            fetchAssignments();
        } else if (status === 'unauthenticated') {
            setAssignments([]);
            setIsLoading(false);
        }
    }, [status, fetchAssignments]);

    // Supabase Realtime subscription
    useEffect(() => {
        if (status !== 'authenticated') return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let channel: any = null;

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
            if (channel) {
                import('@/lib/supabase').then(({ supabase }) => {
                    supabase.removeChannel(channel);
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
            } else {
                // Check if project master exists by title or create new one
                const mastersRes = await fetch(`/api/project-masters?search=${encodeURIComponent(project.title)}`);
                const masters = await mastersRes.json();
                const existing = masters.find((m: ProjectMaster) => m.title === project.title);

                if (existing) {
                    projectMasterId = existing.id;
                } else {
                    // Create new project master
                    const createMasterRes = await fetch('/api/project-masters', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title: project.title,
                            customer: project.customer,
                            constructionType: project.constructionType || 'other',
                            location: project.location,
                            description: project.description,
                            remarks: project.remarks,
                        }),
                    });
                    const newMaster = await createMasterRes.json();
                    projectMasterId = newMaster.id;
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

        // Optimistic update BEFORE API call for smooth UI
        setAssignments(prev => prev.map(a =>
            a.id === id
                ? { ...a, ...updates, date: updates.startDate || a.date }
                : a
        ));

        try {
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
        } catch (error) {
            // Rollback on error
            setAssignments(previousAssignments);
            console.error('Failed to update project:', error);
            throw error;
        }
    }, [assignments]);

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
        await fetchAssignments();
    }, [fetchAssignments]);

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
                refreshProjects,
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
