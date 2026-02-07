import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ProjectMaster, Project, CalendarEvent, CONSTRUCTION_TYPE_COLORS, ProjectAssignment, ConflictError } from '@/types/calendar';
import { DailyReport, DailyReportInput } from '@/types/dailyReport';
import { VacationRecord } from '@/types/vacation';

// カスタムエラークラス: 競合エラー
export class ConflictUpdateError extends Error {
    code = 'CONFLICT' as const;
    latestData: ProjectAssignment;

    constructor(message: string, latestData: ProjectAssignment) {
        super(message);
        this.name = 'ConflictUpdateError';
        this.latestData = latestData;
    }
}

// Types
interface ForemanUser {
    id: string;
    displayName: string;
    role: string;
}

// Helper functions
function parseProjectMasterDates(pm: ProjectMaster & { createdAt: string; updatedAt: string; assemblyDate?: string; demolitionDate?: string }): ProjectMaster {
    return {
        ...pm,
        createdAt: new Date(pm.createdAt),
        updatedAt: new Date(pm.updatedAt),
        assemblyDate: pm.assemblyDate ? new Date(pm.assemblyDate) : undefined,
        demolitionDate: pm.demolitionDate ? new Date(pm.demolitionDate) : undefined,
    };
}

function parseDailyReportDates(report: DailyReport & { date: string; createdAt: string; updatedAt: string }): DailyReport {
    return {
        ...report,
        date: new Date(report.date),
        createdAt: new Date(report.createdAt),
        updatedAt: new Date(report.updatedAt),
    };
}

function assignmentToProject(assignment: ProjectAssignment & { projectMaster?: ProjectMaster; constructionType?: string }): Project {
    // 配置ごとのconstructionTypeを優先、なければProjectMasterから取得
    const constructionType = assignment.constructionType || assignment.projectMaster?.constructionType || 'other';
    const color = CONSTRUCTION_TYPE_COLORS[constructionType as keyof typeof CONSTRUCTION_TYPE_COLORS] || CONSTRUCTION_TYPE_COLORS.other;

    return {
        id: assignment.id,
        title: assignment.projectMaster?.title || '不明な案件',
        startDate: assignment.date,
        category: 'construction',
        color,
        description: assignment.projectMaster?.description,
        location: assignment.projectMaster?.location,
        customer: assignment.projectMaster?.customerShortName || assignment.projectMaster?.customerName,
        workers: assignment.workers,
        trucks: assignment.vehicles,
        remarks: assignment.remarks || assignment.projectMaster?.remarks,
        constructionType: constructionType as 'assembly' | 'demolition' | 'other',
        constructionContent: assignment.projectMaster?.constructionContent,
        assignedEmployeeId: assignment.assignedEmployeeId,
        sortOrder: assignment.sortOrder,
        vehicles: assignment.vehicles,
        meetingTime: assignment.meetingTime,
        projectMasterId: assignment.projectMasterId,
        assignmentId: assignment.id,
        confirmedWorkerIds: assignment.confirmedWorkerIds,
        confirmedVehicleIds: assignment.confirmedVehicleIds,
        isDispatchConfirmed: assignment.isDispatchConfirmed,
        createdBy: assignment.projectMaster?.createdBy,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
    };
}

interface CalendarState {
    // Project Masters
    projectMasters: ProjectMaster[];
    projectMastersLoading: boolean;
    projectMastersError: string | null;
    projectMastersInitialized: boolean;

    // Calendar Display (Foreman settings)
    displayedForemanIds: string[];
    allForemen: ForemanUser[];
    foremanSettingsLoading: boolean;
    foremanSettingsInitialized: boolean;

    // Daily Reports
    dailyReports: DailyReport[];
    dailyReportsLoading: boolean;
    dailyReportsInitialized: boolean;

    // Projects (Assignments)
    assignments: (ProjectAssignment & { projectMaster?: ProjectMaster })[];
    projectsLoading: boolean;
    projectsInitialized: boolean;

    // Vacations
    vacations: VacationRecord;
    vacationsLoading: boolean;
    vacationsInitialized: boolean;

    // Remarks (Calendar remarks)
    remarks: { [dateKey: string]: string };
    remarksLoading: boolean;
    remarksInitialized: boolean;
}

interface CalendarActions {
    // Project Masters
    fetchProjectMasters: (search?: string, status?: string) => Promise<void>;
    createProjectMaster: (data: Omit<ProjectMaster, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ProjectMaster>;
    updateProjectMaster: (id: string, data: Partial<ProjectMaster>) => Promise<ProjectMaster>;
    deleteProjectMaster: (id: string) => Promise<void>;
    getProjectMasterById: (id: string) => ProjectMaster | undefined;

    // Calendar Display (Foreman settings)
    fetchForemen: () => Promise<void>;
    fetchForemanSettings: () => Promise<void>;
    addForeman: (employeeId: string) => Promise<void>;
    removeForeman: (employeeId: string) => Promise<void>;
    moveForeman: (employeeId: string, direction: 'up' | 'down') => Promise<void>;
    getAvailableForemen: () => { id: string; name: string }[];
    getForemanName: (id: string) => string;

    // Daily Reports
    fetchDailyReports: (params?: { foremanId?: string; date?: string; startDate?: string; endDate?: string }) => Promise<void>;
    getDailyReportByForemanAndDate: (foremanId: string, date: string) => DailyReport | undefined;
    saveDailyReport: (input: DailyReportInput) => Promise<DailyReport>;
    deleteDailyReport: (id: string) => Promise<void>;

    // Projects (Assignments)
    fetchAssignments: (startDate?: string, endDate?: string) => Promise<void>;
    addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
    updateProjects: (updates: Array<{ id: string; data: Partial<Project> }>) => Promise<void>;
    deleteProject: (id: string) => Promise<void>;
    getProjectById: (id: string) => Project | undefined;
    getCalendarEvents: () => CalendarEvent[];
    getProjects: () => Project[];

    // Vacations
    fetchVacations: () => Promise<void>;
    getVacationEmployees: (dateKey: string) => string[];
    setVacationEmployees: (dateKey: string, employeeIds: string[]) => Promise<void>;
    addVacationEmployee: (dateKey: string, employeeId: string) => Promise<void>;
    removeVacationEmployee: (dateKey: string, employeeId: string) => Promise<void>;
    getVacationRemarks: (dateKey: string) => string;
    setVacationRemarks: (dateKey: string, remarks: string) => Promise<void>;

    // Remarks (Calendar remarks)
    fetchRemarks: () => Promise<void>;
    getRemark: (dateKey: string) => string;
    setRemark: (dateKey: string, text: string) => Promise<void>;

    // Reset
    reset: () => void;
}

type CalendarStore = CalendarState & CalendarActions;

const initialState: CalendarState = {
    projectMasters: [],
    projectMastersLoading: false,
    projectMastersError: null,
    projectMastersInitialized: false,
    displayedForemanIds: [],
    allForemen: [],
    foremanSettingsLoading: false,
    foremanSettingsInitialized: false,
    dailyReports: [],
    dailyReportsLoading: false,
    dailyReportsInitialized: false,
    assignments: [],
    projectsLoading: false,
    projectsInitialized: false,
    vacations: {},
    vacationsLoading: false,
    vacationsInitialized: false,
    remarks: {},
    remarksLoading: false,
    remarksInitialized: false,
};

export const useCalendarStore = create<CalendarStore>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        // ========== Project Masters ==========
        fetchProjectMasters: async (search?: string, status?: string) => {
            set({ projectMastersLoading: true, projectMastersError: null });
            try {
                const params = new URLSearchParams();
                if (search) params.append('search', search);
                if (status) params.append('status', status);

                const url = `/api/project-masters${params.toString() ? `?${params}` : ''}`;
                const res = await fetch(url);

                if (!res.ok) {
                    throw new Error('案件マスターの取得に失敗しました');
                }

                const data = await res.json();
                set({
                    projectMasters: data.map(parseProjectMasterDates),
                    projectMastersInitialized: true,
                });
            } catch (err) {
                console.error('Fetch project masters error:', err);
                set({ projectMastersError: err instanceof Error ? err.message : '不明なエラー' });
            } finally {
                set({ projectMastersLoading: false });
            }
        },

        createProjectMaster: async (data) => {
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
            const formatted = parseProjectMasterDates(newPm);
            set((state) => ({
                projectMasters: [formatted, ...state.projectMasters],
            }));
            return formatted;
        },

        updateProjectMaster: async (id, data) => {
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
            const formatted = parseProjectMasterDates(updatedPm);
            set((state) => ({
                projectMasters: state.projectMasters.map((pm) => (pm.id === id ? formatted : pm)),
            }));
            return formatted;
        },

        deleteProjectMaster: async (id) => {
            const res = await fetch(`/api/project-masters/${id}`, { method: 'DELETE' });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || '案件マスターの削除に失敗しました');
            }

            set((state) => ({
                projectMasters: state.projectMasters.filter((pm) => pm.id !== id),
            }));
        },

        getProjectMasterById: (id) => get().projectMasters.find((pm) => pm.id === id),

        // ========== Calendar Display (Foreman settings) ==========
        fetchForemen: async () => {
            try {
                const response = await fetch('/api/dispatch/foremen');
                if (response.ok) {
                    const data = await response.json();
                    set({ allForemen: data });
                }
            } catch (error) {
                console.error('Failed to fetch foremen:', error);
            }
        },

        fetchForemanSettings: async () => {
            set({ foremanSettingsLoading: true });
            try {
                const response = await fetch('/api/user-settings');
                if (response.ok) {
                    const data = await response.json();
                    if (data.displayedForemanIds && data.displayedForemanIds.length > 0) {
                        set({ displayedForemanIds: data.displayedForemanIds });
                    }
                }
            } catch (error) {
                console.error('Failed to fetch user settings:', error);
            } finally {
                set({ foremanSettingsLoading: false, foremanSettingsInitialized: true });
            }
        },

        addForeman: async (employeeId) => {
            const { displayedForemanIds } = get();
            if (!displayedForemanIds.includes(employeeId)) {
                const newIds = [...displayedForemanIds, employeeId];
                set({ displayedForemanIds: newIds });
                await fetch('/api/user-settings', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ displayedForemanIds: newIds }),
                });
            }
        },

        removeForeman: async (employeeId) => {
            const newIds = get().displayedForemanIds.filter((id) => id !== employeeId);
            set({ displayedForemanIds: newIds });
            await fetch('/api/user-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayedForemanIds: newIds }),
            });
        },

        moveForeman: async (employeeId, direction) => {
            const { displayedForemanIds } = get();
            const currentIndex = displayedForemanIds.indexOf(employeeId);
            if (currentIndex === -1) return;

            const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (newIndex < 0 || newIndex >= displayedForemanIds.length) return;

            const newIds = [...displayedForemanIds];
            [newIds[currentIndex], newIds[newIndex]] = [newIds[newIndex], newIds[currentIndex]];
            set({ displayedForemanIds: newIds });
            await fetch('/api/user-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayedForemanIds: newIds }),
            });
        },

        getAvailableForemen: () => {
            const { allForemen, displayedForemanIds } = get();
            return allForemen
                .filter((user) => !displayedForemanIds.includes(user.id))
                .map((user) => ({ id: user.id, name: user.displayName }));
        },

        getForemanName: (id) => {
            const foreman = get().allForemen.find((f) => f.id === id);
            return foreman?.displayName || '不明';
        },

        // ========== Daily Reports ==========
        fetchDailyReports: async (params) => {
            set({ dailyReportsLoading: true });
            try {
                const searchParams = new URLSearchParams();
                if (params?.foremanId) searchParams.set('foremanId', params.foremanId);
                if (params?.date) searchParams.set('date', params.date);
                if (params?.startDate) searchParams.set('startDate', params.startDate);
                if (params?.endDate) searchParams.set('endDate', params.endDate);

                const response = await fetch(`/api/daily-reports?${searchParams.toString()}`);
                if (response.ok) {
                    const data = await response.json();
                    set({
                        dailyReports: data.map(parseDailyReportDates),
                        dailyReportsInitialized: true,
                    });
                }
            } catch (error) {
                console.error('Failed to fetch daily reports:', error);
            } finally {
                set({ dailyReportsLoading: false });
            }
        },

        getDailyReportByForemanAndDate: (foremanId, date) => {
            return get().dailyReports.find((report) => {
                const reportDate = report.date instanceof Date ? report.date.toISOString().split('T')[0] : report.date;
                return report.foremanId === foremanId && reportDate === date;
            });
        },

        saveDailyReport: async (input) => {
            const response = await fetch('/api/daily-reports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save daily report');
            }

            const saved = await response.json();
            const parsed = parseDailyReportDates(saved);

            set((state) => {
                const existingIndex = state.dailyReports.findIndex((r) => r.id === parsed.id);
                if (existingIndex >= 0) {
                    const updated = [...state.dailyReports];
                    updated[existingIndex] = parsed;
                    return { dailyReports: updated };
                }
                return { dailyReports: [...state.dailyReports, parsed] };
            });

            return parsed;
        },

        deleteDailyReport: async (id) => {
            const response = await fetch(`/api/daily-reports/${id}`, { method: 'DELETE' });

            if (!response.ok) {
                throw new Error('Failed to delete daily report');
            }

            set((state) => ({
                dailyReports: state.dailyReports.filter((r) => r.id !== id),
            }));
        },

        // ========== Projects (Assignments) ==========
        fetchAssignments: async (startDate, endDate) => {
            set({ projectsLoading: true });
            try {
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
                const mastersRes = await fetch(`/api/project-masters?search=${encodeURIComponent(project.title)}`);
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

            // workSchedulesがある場合は各日ごとにassignment作成
            if (project.workSchedules && project.workSchedules.length > 0) {
                const dailySchedules = project.workSchedules.flatMap(ws => ws.dailySchedules);
                const newAssignments = [];

                for (const schedule of dailySchedules) {
                    const response = await fetch('/api/assignments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
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
                        }),
                    });

                    if (!response.ok) throw new Error('Failed to create assignment');
                    newAssignments.push(await response.json());
                }

                const parsed = newAssignments.map(a => parseAssignmentResponse(a));
                set((state) => ({ assignments: [...state.assignments, ...parsed] }));
            } else {
                const response = await fetch('/api/assignments', {
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
                        constructionType: project.constructionType,
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
                // ProjectMasterの更新が必要な場合（createdBy, constructionContent）
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
                        expectedUpdatedAt: assignment?.updatedAt?.toISOString(), // 楽観的ロック用
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
                        constructionType: updates.constructionType,
                    }),
                });

                if (response.status === 409) {
                    // 競合エラー: 他のユーザーが先に更新している
                    const errorData = await response.json() as ConflictError;
                    // ロールバック
                    set({ assignments: previousAssignments });
                    throw new ConflictUpdateError(errorData.error, errorData.latestData);
                }

                if (!response.ok) {
                    throw new Error('Failed to update assignment');
                }

                // 成功時: サーバーから返された最新データでローカル状態を更新
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
                // ConflictUpdateError以外のエラーの場合のみロールバック
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
                                expectedUpdatedAt: assignment?.updatedAt?.toISOString(), // 楽観的ロック用
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
                    // 競合エラー: 他のユーザーが先に更新している
                    const errorData = await response.json() as ConflictError;
                    // ロールバック
                    set({ assignments: previousAssignments });
                    throw new ConflictUpdateError(errorData.error, errorData.latestData);
                }

                if (!response.ok) {
                    throw new Error('Failed to update assignments');
                }
            } catch (error) {
                // ConflictUpdateError以外のエラーの場合のみロールバック
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

        // ========== Vacations ==========
        fetchVacations: async () => {
            set({ vacationsLoading: true });
            try {
                const response = await fetch('/api/calendar/vacations');
                if (response.ok) {
                    const data = await response.json();
                    set({ vacations: data, vacationsInitialized: true });
                }
            } catch (error) {
                console.error('Failed to fetch vacations:', error);
            } finally {
                set({ vacationsLoading: false });
            }
        },

        getVacationEmployees: (dateKey: string) => {
            return get().vacations[dateKey]?.employeeIds || [];
        },

        setVacationEmployees: async (dateKey: string, employeeIds: string[]) => {
            const currentRemarks = get().vacations[dateKey]?.remarks || '';
            set((state) => ({
                vacations: {
                    ...state.vacations,
                    [dateKey]: { employeeIds, remarks: currentRemarks },
                },
            }));
            try {
                await fetch('/api/calendar/vacations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateKey, employeeIds, remarks: currentRemarks }),
                });
            } catch (error) {
                console.error('Failed to save vacation:', error);
                get().fetchVacations();
            }
        },

        addVacationEmployee: async (dateKey: string, employeeId: string) => {
            const current = get().getVacationEmployees(dateKey);
            if (!current.includes(employeeId)) {
                await get().setVacationEmployees(dateKey, [...current, employeeId]);
            }
        },

        removeVacationEmployee: async (dateKey: string, employeeId: string) => {
            const current = get().getVacationEmployees(dateKey);
            await get().setVacationEmployees(dateKey, current.filter((id) => id !== employeeId));
        },

        getVacationRemarks: (dateKey: string) => {
            return get().vacations[dateKey]?.remarks || '';
        },

        setVacationRemarks: async (dateKey: string, remarks: string) => {
            const currentEmployees = get().vacations[dateKey]?.employeeIds || [];
            set((state) => ({
                vacations: {
                    ...state.vacations,
                    [dateKey]: { employeeIds: currentEmployees, remarks },
                },
            }));
            try {
                await fetch('/api/calendar/vacations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateKey, employeeIds: currentEmployees, remarks }),
                });
            } catch (error) {
                console.error('Failed to save vacation remarks:', error);
                get().fetchVacations();
            }
        },

        // ========== Remarks (Calendar remarks) ==========
        fetchRemarks: async () => {
            set({ remarksLoading: true });
            try {
                const response = await fetch('/api/calendar/remarks');
                if (response.ok) {
                    const data = await response.json();
                    set({ remarks: data, remarksInitialized: true });
                }
            } catch (error) {
                console.error('Failed to fetch remarks:', error);
            } finally {
                set({ remarksLoading: false });
            }
        },

        getRemark: (dateKey: string) => {
            return get().remarks[dateKey] || '';
        },

        setRemark: async (dateKey: string, text: string) => {
            // Optimistic update
            set((state) => ({
                remarks: {
                    ...state.remarks,
                    [dateKey]: text,
                },
            }));
            try {
                await fetch('/api/calendar/remarks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateKey, text }),
                });
            } catch (error) {
                console.error('Failed to set remark:', error);
                get().fetchRemarks();
            }
        },

        reset: () => set(initialState),
    }))
);

// Selectors
export const selectProjectMasters = (state: CalendarStore) => state.projectMasters;
export const selectProjectMastersLoading = (state: CalendarStore) => state.projectMastersLoading;
export const selectDisplayedForemanIds = (state: CalendarStore) => state.displayedForemanIds;
export const selectAllForemen = (state: CalendarStore) => state.allForemen;
export const selectDailyReports = (state: CalendarStore) => state.dailyReports;
export const selectDailyReportsLoading = (state: CalendarStore) => state.dailyReportsLoading;
export const selectProjects = (state: CalendarStore) => state.assignments.map(assignmentToProject);
export const selectProjectsLoading = (state: CalendarStore) => state.projectsLoading;
export const selectProjectsInitialized = (state: CalendarStore) => state.projectsInitialized;

export const selectVacations = (state: CalendarStore) => state.vacations;
export const selectVacationsLoading = (state: CalendarStore) => state.vacationsLoading;
export const selectVacationsInitialized = (state: CalendarStore) => state.vacationsInitialized;

export const selectRemarks = (state: CalendarStore) => state.remarks;
export const selectRemarksLoading = (state: CalendarStore) => state.remarksLoading;
export const selectRemarksInitialized = (state: CalendarStore) => state.remarksInitialized;
