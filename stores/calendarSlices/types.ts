import { ProjectMaster, Project, CalendarEvent, CONSTRUCTION_TYPE_COLORS, ProjectAssignment, ConflictError } from '@/types/calendar';
import { DailyReport, DailyReportInput } from '@/types/dailyReport';
import { VacationRecord } from '@/types/vacation';
import { StateCreator } from 'zustand';

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
export interface ForemanUser {
    id: string;
    displayName: string;
    role: string;
}

// Helper functions
export function parseProjectMasterDates(pm: ProjectMaster & { createdAt: string; updatedAt: string; assemblyDate?: string; demolitionDate?: string }): ProjectMaster {
    return {
        ...pm,
        createdAt: new Date(pm.createdAt),
        updatedAt: new Date(pm.updatedAt),
        assemblyDate: pm.assemblyDate ? new Date(pm.assemblyDate) : undefined,
        demolitionDate: pm.demolitionDate ? new Date(pm.demolitionDate) : undefined,
    };
}

export function parseDailyReportDates(report: DailyReport & { date: string; createdAt: string; updatedAt: string }): DailyReport {
    return {
        ...report,
        date: new Date(report.date),
        createdAt: new Date(report.createdAt),
        updatedAt: new Date(report.updatedAt),
    };
}

export function assignmentToProject(assignment: ProjectAssignment & { projectMaster?: ProjectMaster; constructionType?: string }): Project {
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
        memberCount: assignment.memberCount,
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

export interface CalendarState {
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

export interface CalendarActions {
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

export type CalendarStore = CalendarState & CalendarActions;
export type CalendarSlice<T> = StateCreator<CalendarStore, [['zustand/subscribeWithSelector', never]], [], T>;

// Re-export types used by slices
export type { ProjectMaster, Project, CalendarEvent, ProjectAssignment, ConflictError, DailyReport, DailyReportInput, VacationRecord };
