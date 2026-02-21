import { ProjectMaster, ProjectAssignment, ConflictError } from '@/types/calendar';
import { CalendarSlice, CalendarActions, CalendarState, ConflictUpdateError, assignmentToProject, parseProjectMasterDates } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';

type AssignmentSlice = Pick<CalendarState, 'assignments' | 'projectsLoading' | 'projectsInitialized'> &
    Pick<CalendarActions, 'fetchAssignments' | 'addProject' | 'updateProject' | 'updateProjects' | 'deleteProject' | 'getProjectById' | 'getCalendarEvents' | 'getProjects' | 'upsertAssignment' | 'removeAssignmentById' | 'updateProjectMasterInAssignments'>;

export const createAssignmentSlice: CalendarSlice<AssignmentSlice> = (set, get) => ({
    assignments: [],
    projectsLoading: false,
    projectsInitialized: false,

    fetchAssignments: async (startDate, endDate) => {
        set({ projectsLoading: true });
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            const url = `/api/assignments${params.toString() ? `?${params}` : ''}`;

            const response = await fetch(url, { cache: 'no-store' });
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
                set({ assignments: parsed, projectsInitialized: true });
            }
        } catch (error) {
            console.error('Failed to fetch assignments:', error);
        } finally {
            set({ projectsLoading: false });
        }
    },

    addProject: async (project) => {
        let projectMasterId: string;
        let broadcastMasterId: string | null = null;

        if (project.projectMasterId) {
            projectMasterId = project.projectMasterId;
            if (project.constructionType || project.createdBy || project.constructionContent) {
                const updateData: Record<string, unknown> = {};
                if (project.constructionType) updateData.constructionType = project.constructionType;
                if (project.createdBy) updateData.createdBy = project.createdBy;
                if (project.constructionContent) updateData.constructionContent = project.constructionContent;
                await fetch(`/api/project-masters/${project.projectMasterId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updateData),
                });
            }
        } else {
            const mastersRes = await fetch(`/api/project-masters?search=${encodeURIComponent(project.title)}`, { cache: 'no-store' });
            const masters = await mastersRes.json();
            const existing = masters.find((m: ProjectMaster) => m.title === project.title);

            if (existing) {
                projectMasterId = existing.id;
                if ((project.constructionType && existing.constructionType !== project.constructionType) || project.createdBy || project.constructionContent) {
                    const updateData: Record<string, unknown> = {};
                    if (project.constructionType && existing.constructionType !== project.constructionType) {
                        updateData.constructionType = project.constructionType;
                    }
                    if (project.createdBy) updateData.createdBy = project.createdBy;
                    if (project.constructionContent) updateData.constructionContent = project.constructionContent;
                    await fetch(`/api/project-masters/${existing.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updateData),
                    });
                }
            } else {
                const createMasterRes = await fetch('/api/project-masters', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: project.title,
                        customerName: project.customer,
                        constructionType: project.constructionType || 'other',
                        constructionContent: project.constructionContent,
                        location: project.location,
                        description: project.description,
                        remarks: project.remarks,
                        createdBy: project.createdBy,
                    }),
                });
                const newMaster = await createMasterRes.json();
                projectMasterId = newMaster.id;
                broadcastMasterId = newMaster.id; // 配置作成後にブロードキャストするためIDを保持
                // projectMasters ストアに追加
                const formatted = parseProjectMasterDates(newMaster);
                set((state) => ({
                    projectMasters: [formatted, ...state.projectMasters],
                }));
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parseAssignmentResponse = (a: any): ProjectAssignment & { projectMaster?: ProjectMaster } => ({
            ...a,
            date: new Date(a.date),
            createdAt: new Date(a.createdAt),
            updatedAt: new Date(a.updatedAt),
            projectMaster: a.projectMaster ? {
                ...a.projectMaster,
                createdAt: new Date(a.projectMaster.createdAt),
                updatedAt: new Date(a.projectMaster.updatedAt),
            } : undefined,
        });

        // workSchedulesがある場合は一括作成APIで全日程を一度に作成
        if (project.workSchedules && project.workSchedules.length > 0) {
            const dailySchedules = project.workSchedules.flatMap(ws => ws.dailySchedules);

            const assignmentData = dailySchedules.map(schedule => ({
                projectMasterId,
                assignedEmployeeId: schedule.assignedEmployeeId || project.assignedEmployeeId,
                date: schedule.date instanceof Date ? schedule.date.toISOString() : schedule.date,
                memberCount: schedule.memberCount || 0,
                workers: schedule.workers?.length ? schedule.workers : project.workers,
                vehicles: schedule.trucks?.length ? schedule.trucks : project.vehicles,
                meetingTime: project.meetingTime,
                sortOrder: schedule.sortOrder || 0,
                remarks: schedule.remarks || project.remarks,
                constructionType: project.constructionType,
                estimatedHours: project.estimatedHours ?? 8.0,
            }));

            const response = await fetch('/api/assignments/batch-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignments: assignmentData }),
            });

            if (!response.ok) throw new Error('Failed to create assignments');
            const newAssignments = await response.json();
            if (!Array.isArray(newAssignments)) {
                throw new Error('Invalid response: expected array of assignments');
            }

            const parsed = newAssignments.map((a: Parameters<typeof parseAssignmentResponse>[0]) => parseAssignmentResponse(a));
            set((state) => {
                const newIds = new Set(parsed.map((a: { id: string }) => a.id));
                const filtered = state.assignments.filter(a => !newIds.has(a.id));
                return { assignments: [...filtered, ...parsed] };
            });
        } else {
            const response = await fetch('/api/assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectMasterId,
                    assignedEmployeeId: project.assignedEmployeeId,
                    date: project.startDate instanceof Date ? project.startDate.toISOString() : project.startDate,
                    memberCount: project.memberCount || project.workers?.length || 0,
                    workers: project.workers,
                    vehicles: project.vehicles,
                    meetingTime: project.meetingTime,
                    sortOrder: project.sortOrder || 0,
                    remarks: project.remarks,
                    constructionType: project.constructionType,
                    estimatedHours: project.estimatedHours ?? 8.0,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to create assignment');
            }

            const newAssignment = await response.json();
            set((state) => ({
                assignments: [...state.assignments, parseAssignmentResponse(newAssignment)],
            }));
        }

        // 新規マスター作成時は配置作成完了後にブロードキャスト（配置数を正確に反映するため）
        if (broadcastMasterId) {
            sendBroadcast('project_master_updated', { id: broadcastMasterId });
        }
    },

    updateProject: async (id, updates) => {
        const { assignments } = get();
        const previousAssignments = [...assignments];
        const assignment = assignments.find((a) => a.id === id);

        // Optimistic update
        set((state) => ({
            assignments: state.assignments.map((a) =>
                a.id === id ? { ...a, ...updates, date: updates.startDate || a.date } : a
            ),
        }));

        try {
            // ProjectMasterの更新が必要な場合
            if (assignment?.projectMasterId && (updates.createdBy || updates.constructionContent)) {
                const projectMasterUpdates: Record<string, unknown> = {};
                if (updates.createdBy) projectMasterUpdates.createdBy = updates.createdBy;
                if (updates.constructionContent) projectMasterUpdates.constructionContent = updates.constructionContent;

                await fetch(`/api/project-masters/${assignment.projectMasterId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(projectMasterUpdates),
                });
            }

            const response = await fetch(`/api/assignments/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    expectedUpdatedAt: assignment?.updatedAt?.toISOString(),
                    assignedEmployeeId: updates.assignedEmployeeId,
                    date: updates.startDate instanceof Date ? updates.startDate.toISOString() : updates.startDate,
                    memberCount: updates.memberCount ?? updates.workers?.length ?? assignment?.memberCount,
                    workers: updates.workers,
                    vehicles: updates.vehicles,
                    meetingTime: updates.meetingTime,
                    sortOrder: updates.sortOrder,
                    remarks: updates.remarks,
                    isDispatchConfirmed: updates.isDispatchConfirmed,
                    confirmedWorkerIds: updates.confirmedWorkerIds,
                    confirmedVehicleIds: updates.confirmedVehicleIds,
                    constructionType: updates.constructionType,
                    estimatedHours: updates.estimatedHours,
                }),
            });

            if (response.status === 409) {
                const errorData = await response.json() as ConflictError;
                set({ assignments: previousAssignments });
                throw new ConflictUpdateError(errorData.error, errorData.latestData);
            }

            if (!response.ok) {
                throw new Error('Failed to update assignment');
            }

            const updatedAssignment = await response.json();
            set((state) => ({
                assignments: state.assignments.map((a) =>
                    a.id === id ? {
                        ...a,
                        ...updatedAssignment,
                        date: new Date(updatedAssignment.date),
                        createdAt: new Date(updatedAssignment.createdAt),
                        updatedAt: new Date(updatedAssignment.updatedAt),
                    } : a
                ),
            }));
        } catch (error) {
            if (!(error instanceof ConflictUpdateError)) {
                set({ assignments: previousAssignments });
            }
            throw error;
        }
    },

    updateProjects: async (updates) => {
        const { assignments } = get();
        const previousAssignments = [...assignments];

        // Optimistic update
        set((state) => {
            const newAssignments = [...state.assignments];
            updates.forEach((update) => {
                const index = newAssignments.findIndex((a) => a.id === update.id);
                if (index !== -1) {
                    newAssignments[index] = {
                        ...newAssignments[index],
                        ...update.data,
                        date: update.data.startDate || newAssignments[index].date,
                    };
                }
            });
            return { assignments: newAssignments };
        });

        try {
            const response = await fetch('/api/assignments/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    updates: updates.map((u) => {
                        const assignment = assignments.find((a) => a.id === u.id);
                        return {
                            id: u.id,
                            expectedUpdatedAt: assignment?.updatedAt?.toISOString(),
                            data: {
                                assignedEmployeeId: u.data.assignedEmployeeId,
                                date: u.data.startDate instanceof Date ? u.data.startDate.toISOString() : u.data.startDate,
                                sortOrder: u.data.sortOrder,
                                workers: u.data.workers,
                                vehicles: u.data.vehicles,
                                meetingTime: u.data.meetingTime,
                                remarks: u.data.remarks,
                            },
                        };
                    }),
                }),
            });

            if (response.status === 409) {
                const errorData = await response.json() as ConflictError;
                set({ assignments: previousAssignments });
                throw new ConflictUpdateError(errorData.error, errorData.latestData);
            }

            if (!response.ok) {
                throw new Error('Failed to update assignments');
            }
        } catch (error) {
            if (!(error instanceof ConflictUpdateError)) {
                set({ assignments: previousAssignments });
            }
            throw error;
        }
    },

    deleteProject: async (id) => {
        await fetch(`/api/assignments/${id}`, { method: 'DELETE' });
        set((state) => ({
            assignments: state.assignments.filter((a) => a.id !== id),
        }));
    },

    getProjectById: (id) => {
        const assignment = get().assignments.find((a) => a.id === id);
        return assignment ? assignmentToProject(assignment) : undefined;
    },

    getCalendarEvents: () => get().assignments.map(assignmentToProject),

    getProjects: () => get().assignments.map(assignmentToProject),

    upsertAssignment: (assignment) => {
        set((state) => {
            const exists = state.assignments.some((a) => a.id === assignment.id);
            if (exists) {
                return { assignments: state.assignments.map((a) => a.id === assignment.id ? assignment : a) };
            } else {
                return { assignments: [...state.assignments, assignment] };
            }
        });
    },

    removeAssignmentById: (id) => {
        set((state) => ({
            assignments: state.assignments.filter((a) => a.id !== id),
        }));
    },

    updateProjectMasterInAssignments: (projectMaster) => {
        set((state) => ({
            assignments: state.assignments.map((a) =>
                a.projectMasterId === projectMaster.id
                    ? { ...a, projectMaster }
                    : a
            ),
        }));
    },
});
