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

// dateKey (YYYY-MM-DD) の取得範囲。固定長文字列なので辞書順比較=日付順比較
export interface DateKeyRange {
    from: string;
    to: string;
}

/**
 * 2つのマップが同一内容かを判定する。
 * ポーリング（Realtime補完）の再フェッチは内容が変わっていないことが大半なので、
 * 同一なら既存参照を使い回してカレンダー全体の再レンダーを抑える用途。
 * vacations のように値がオブジェクトのマップがあるため、値は JSON で比較する。
 */
export function recordEquals<V>(a: Record<string, V>, b: Record<string, V>): boolean {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
        const av = a[key];
        const bv = b[key];
        if (av === bv) continue;
        if (bv === undefined || JSON.stringify(av) !== JSON.stringify(bv)) return false;
    }
    return true;
}

/**
 * 範囲フェッチ結果をマップへ反映する共通ロジック。
 * 既存マップから範囲内のキーを除去してからフェッチ結果を上書きする
 * （範囲内で削除されたエントリを確実に消し、範囲外のキャッシュは保持）。
 * cellRemarks のような複合キーは extractDateKey で dateKey 部分を取り出す。
 * マージ結果が現在値と同一なら現在の参照をそのまま返す（購読側の再レンダー防止）。
 */
export function mergeRangeFetchedMap<V>(
    current: Record<string, V>,
    fetched: Record<string, V>,
    range: DateKeyRange,
    extractDateKey: (key: string) => string = (key) => key,
): Record<string, V> {
    const next: Record<string, V> = {};
    for (const [key, value] of Object.entries(current)) {
        const dateKey = extractDateKey(key);
        if (dateKey >= range.from && dateKey <= range.to) continue; // 範囲内は破棄して差し替え
        next[key] = value;
    }
    Object.assign(next, fetched);
    return recordEquals(current, next) ? current : next;
}

// Types
export interface ForemanUser {
    id: string;
    displayName: string;
    role: string;
}

export interface MemberUser {
    id: string;
    displayName: string;
}

// Helper functions
export function parseProjectMasterDates(pm: ProjectMaster & { createdAt: string; updatedAt: string }): ProjectMaster {
    return {
        ...pm,
        createdAt: new Date(pm.createdAt),
        updatedAt: new Date(pm.updatedAt),
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

    // 3フィールド分離前の古い案件はname=nullなので、titleからフォールバック
    const pm = assignment.projectMaster;
    const hasNameField = !!pm?.name;
    const resolvedName = hasNameField ? pm!.name : pm?.title || '';
    const resolvedHonorific = hasNameField ? (pm!.honorific ?? '様邸') : '';

    // カード表示用: name+honorific+siteShortName（工事名称は非表示）
    // siteShortName は個人名案件の識別メモ。"佐藤様 新宿" のようにスペース区切りで表示
    const site = pm?.siteShortName ? ` ${pm.siteShortName}` : '';
    const cardTitle = hasNameField
        ? `${pm!.name || ''}${pm!.honorific || ''}${site}` || '不明な案件'
        : pm?.title || '不明な案件';

    return {
        id: assignment.id,
        title: cardTitle,
        name: resolvedName,
        honorific: resolvedHonorific,
        constructionSuffixId: pm?.constructionSuffixId,
        siteShortName: pm?.siteShortName ?? null,
        startDate: assignment.date,
        category: 'construction',
        color,
        description: assignment.projectMaster?.description,
        location: [assignment.projectMaster?.prefecture, assignment.projectMaster?.city, assignment.projectMaster?.location].filter(Boolean).join(''),
        customer: assignment.projectMaster?.customerShortName || assignment.projectMaster?.customerName,
        memberCount: assignment.memberCount,
        estimatedHours: assignment.estimatedHours ?? 8.0,
        workers: assignment.workers,
        trucks: assignment.vehicles,
        remarks: assignment.remarks || '',
        dispatchRemark: assignment.dispatchRemark || '',
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
        workStartedAt: assignment.workStartedAt ?? null,
        workEndedAt: assignment.workEndedAt ?? null,
        workStartedComment: assignment.workStartedComment ?? null,
        workEndedComment: assignment.workEndedComment ?? null,
        createdBy: assignment.projectMaster?.createdBy,
        createdAt: assignment.createdAt,
        // 最終更新日は「案件の編集」のみ反映する。スケジュール移動（assignment更新）では変化させない。
        updatedAt: pm?.updatedAt ?? assignment.updatedAt,
        updatedBy: pm?.updatedBy ?? assignment.updatedBy,
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

    // All active members (含worker) - VacationSelectorなどで使用。fetchはfetchAllMembers経由で重複排除
    allMembers: MemberUser[];
    allMembersInitialized: boolean;

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

    // Cell Remarks (Foreman x Date remarks)
    cellRemarks: { [key: string]: string };
    cellRemarksLoading: boolean;
    cellRemarksInitialized: boolean;

    // Member Adjustments (per-day extra/reduced members)
    memberAdjustments: { [dateKey: string]: number };
    memberAdjustmentsInitialized: boolean;
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
    fetchAllMembers: () => Promise<void>;
    addForeman: (employeeId: string) => Promise<void>;
    removeForeman: (employeeId: string) => Promise<void>;
    moveForeman: (employeeId: string, direction: 'up' | 'down') => Promise<void>;
    getAvailableForemen: () => { id: string; name: string }[];
    getForemanName: (id: string) => string;
    initializeForemenFromAll: () => void;

    // Daily Reports
    fetchDailyReports: (params?: { foremanId?: string; date?: string; startDate?: string; endDate?: string }) => Promise<void>;
    getDailyReportByForemanAndDate: (foremanId: string, date: string) => DailyReport | undefined;
    saveDailyReport: (input: DailyReportInput) => Promise<DailyReport>;
    deleteDailyReport: (id: string) => Promise<void>;

    // Projects (Assignments)
    fetchAssignments: (startDate?: string, endDate?: string, _retryCount?: number) => Promise<void>;
    addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
    updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
    updateProjects: (updates: Array<{ id: string; data: Partial<Project> }>) => Promise<void>;
    // 配置を浮き（班未定）に戻す＝降格。正門 POST /api/assignments/floating/[id] 経由。
    // date を渡すと降格と同時に別日へ移動する（浮きレーンの別日セルへドロップ/移動）。
    demoteToFloating: (id: string, date?: Date) => Promise<void>;
    // 削除に成功すると、復元用の控え（DeletedAssignmentLog）の logId を返す（控えに失敗した場合は null）。
    deleteProject: (id: string) => Promise<string | null>;
    // 誤削除のUndo。いずれも物理削除→再作成のため新しいIDで作られる。
    // restoreAssignment: クライアント保持のスナップショットから再作成（控えが使えないとき用のフォールバック）。
    restoreAssignment: (snapshot: ProjectAssignment & { projectMaster?: ProjectMaster }) => Promise<ProjectAssignment & { projectMaster?: ProjectMaster }>;
    // restoreDeletedAssignment: サーバーの削除控え（logId）から復元し、控えを復元済みにする。
    restoreDeletedAssignment: (logId: string) => Promise<ProjectAssignment & { projectMaster?: ProjectMaster }>;
    getProjectById: (id: string) => Project | undefined;
    getCalendarEvents: () => CalendarEvent[];
    getProjects: () => Project[];
    // Realtime incremental sync
    upsertAssignment: (assignment: ProjectAssignment & { projectMaster?: ProjectMaster }) => void;
    // 複数件を1回の set で反映する（Realtimeイベントのまとめ反映用）。
    // removeIds は表示範囲外へ移動した配置の掃除用。内容が変わらなければ状態を更新しない。
    upsertAssignments: (assignments: (ProjectAssignment & { projectMaster?: ProjectMaster })[], removeIds?: string[]) => void;
    removeAssignmentById: (id: string) => void;
    updateProjectMasterInAssignments: (projectMaster: ProjectMaster) => void;

    // Vacations
    // range 指定時はその期間のみ再取得し、ストアは期間内キーだけ差し替える（期間外は保持）。
    // 省略時は全件取得（従来挙動）。
    fetchVacations: (range?: DateKeyRange) => Promise<void>;
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

    // Cell Remarks (Foreman x Date remarks)
    fetchCellRemarks: (range?: DateKeyRange) => Promise<void>;
    getCellRemark: (foremanId: string, dateKey: string) => string;
    setCellRemark: (foremanId: string, dateKey: string, text: string) => Promise<void>;

    // Member Adjustments (per-day)
    fetchMemberAdjustments: (range?: DateKeyRange) => Promise<void>;
    getMemberAdjustment: (dateKey: string) => number;
    setMemberAdjustment: (dateKey: string, adjustment: number) => Promise<void>;

    // Reset
    reset: () => void;
}

export type CalendarStore = CalendarState & CalendarActions;
export type CalendarSlice<T> = StateCreator<CalendarStore, [['zustand/subscribeWithSelector', never]], [], T>;

// Re-export types used by slices
export type { ProjectMaster, Project, CalendarEvent, ProjectAssignment, ConflictError, DailyReport, DailyReportInput, VacationRecord };
