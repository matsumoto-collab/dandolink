import { ProjectMaster, ProjectAssignment, ConflictError } from '@/types/calendar';
import { CalendarSlice, CalendarActions, CalendarState, ConflictUpdateError, assignmentToProject, parseProjectMasterDates } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';
import { formatDateKey } from '@/utils/employeeUtils';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';

const MAX_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

// 連打時に前回の in-flight リクエストをキャンセルするためのコントローラ
let currentAbortController: AbortController | null = null;

// 復元API（POST /api/assignments もしくは /restore）が返す formatAssignment 形を
// ストア用に Date 化する。parse の流儀は fetchAssignments と揃える。
function parseRestoredAssignment(
    created: ProjectAssignment & { date: string; createdAt: string; updatedAt: string; projectMaster?: ProjectMaster & { createdAt: string; updatedAt: string } },
    fallbackPm?: ProjectMaster
): ProjectAssignment & { projectMaster?: ProjectMaster } {
    return {
        ...created,
        date: new Date(created.date),
        createdAt: new Date(created.createdAt),
        updatedAt: new Date(created.updatedAt),
        workStartedAt: created.workStartedAt ? new Date(created.workStartedAt) : null,
        workEndedAt: created.workEndedAt ? new Date(created.workEndedAt) : null,
        workStartedComment: created.workStartedComment ?? null,
        workEndedComment: created.workEndedComment ?? null,
        projectMaster: created.projectMaster ? {
            ...created.projectMaster,
            createdAt: new Date(created.projectMaster.createdAt),
            updatedAt: new Date(created.projectMaster.updatedAt),
        } : fallbackPm,
    };
}

type AssignmentSlice = Pick<CalendarState, 'assignments' | 'projectsLoading' | 'projectsInitialized'> &
    Pick<CalendarActions, 'fetchAssignments' | 'addProject' | 'updateProject' | 'updateProjects' | 'deleteProject' | 'restoreAssignment' | 'restoreDeletedAssignment' | 'getProjectById' | 'getCalendarEvents' | 'getProjects' | 'upsertAssignment' | 'removeAssignmentById' | 'updateProjectMasterInAssignments'>;

export const createAssignmentSlice: CalendarSlice<AssignmentSlice> = (set, get) => ({
    assignments: [],
    projectsLoading: false,
    projectsInitialized: false,

    fetchAssignments: async (startDate, endDate, _retryCount = 0) => {
        if (_retryCount === 0) {
            if (currentAbortController) {
                currentAbortController.abort();
            }
            currentAbortController = new AbortController();
            set({ projectsLoading: true });
        }
        const signal = currentAbortController?.signal;
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            const url = `/api/assignments${params.toString() ? `?${params}` : ''}`;

            const response = await fetch(url, { cache: 'no-store', signal });
            if (response.ok) {
                const data = await response.json();
                const parsed = data.map((a: ProjectAssignment & { date: string; createdAt: string; updatedAt: string; workStartedAt?: string | null; workEndedAt?: string | null; workStartedComment?: string | null; workEndedComment?: string | null; projectMaster?: ProjectMaster & { createdAt: string; updatedAt: string } }) => ({
                    ...a,
                    date: new Date(a.date),
                    createdAt: new Date(a.createdAt),
                    updatedAt: new Date(a.updatedAt),
                    workStartedAt: a.workStartedAt ? new Date(a.workStartedAt) : null,
                    workEndedAt: a.workEndedAt ? new Date(a.workEndedAt) : null,
                    workStartedComment: a.workStartedComment ?? null,
                    workEndedComment: a.workEndedComment ?? null,
                    projectMaster: a.projectMaster ? {
                        ...a.projectMaster,
                        createdAt: new Date(a.projectMaster.createdAt),
                        updatedAt: new Date(a.projectMaster.updatedAt),
                    } : undefined,
                }));
                set({ assignments: parsed, projectsInitialized: true });
            } else if (response.status === 429 && _retryCount < MAX_RETRY_COUNT) {
                const retryAfter = response.headers.get('Retry-After');
                const delayMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 10000) : DEFAULT_RETRY_DELAY_MS;
                logger.warn(`Rate limited (429). Retrying in ${delayMs}ms (attempt ${_retryCount + 1}/${MAX_RETRY_COUNT})`);
                await new Promise(r => setTimeout(r, delayMs));
                return get().fetchAssignments(startDate, endDate, _retryCount + 1);
            } else {
                logger.error('Failed to fetch assignments: HTTP', response.status);
                if (response.status === 429) {
                    toast.error('サーバーが混み合っています。しばらく待ってから再度お試しください。');
                }
                set({ projectsInitialized: true });
            }
        } catch (error) {
            // 新しいリクエストに abort された場合は無視
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            logger.error('Failed to fetch assignments:', error);
            set({ projectsInitialized: true });
        } finally {
            if (_retryCount === 0 && !signal?.aborted) set({ projectsLoading: false });
        }
    },

    addProject: async (project) => {
        let projectMasterId: string;
        let broadcastMasterId: string | null = null;
        // 新規作成した配置IDを集めて、最後にbroadcast送信する。
        // 送らないと別端末がpostgres_changes(WAL)経由でしか拾えず、反映が1分前後遅れる。
        const newAssignmentIds: string[] = [];

        if (project.projectMasterId) {
            projectMasterId = project.projectMasterId;
            // 既存PMに新規アサインを追加する場合、PM値が実際に変わっているときだけPATCH
            // （でないとPMの updatedAt が配置追加のたびに触られてしまう）
            const currentPm = get().projectMasters.find(pm => pm.id === project.projectMasterId);
            const updateData: Record<string, unknown> = {};
            if (project.constructionType && currentPm?.constructionType !== project.constructionType) {
                updateData.constructionType = project.constructionType;
            }
            if (project.createdBy && JSON.stringify(currentPm?.createdBy ?? null) !== JSON.stringify(project.createdBy)) {
                updateData.createdBy = project.createdBy;
            }
            if (project.constructionContent && currentPm?.constructionContent !== project.constructionContent) {
                updateData.constructionContent = project.constructionContent;
            }
            if (Object.keys(updateData).length > 0) {
                // 配置の副作用としての同期更新では、ProjectMaster.updatedAt を進めない。
                // ユーザーが案件詳細を明示的に編集していないのに「最終更新日」が
                // 変わると混乱を招くため、syncOnly フラグで raw SQL 更新に切り替える。
                // ※この設計は意図的なので、通常の update に戻さないでください。
                const patchRes = await fetch(`/api/project-masters/${project.projectMasterId}?syncOnly=true`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updateData),
                });
                if (!patchRes.ok) throw new Error('Failed to update project master');
            }
        } else {
            // 「新規作成」での案件登録は、現場名（title）が同じでも常に新しい案件マスタを作成する。
            // 以前は GET /api/project-masters?search で title 完全一致の既存マスタを探して再利用して
            // いたが、同名の別案件（特に「○○様邸」など住宅で頻発）を誤って既存案件へ吸収してしまい、
            // 「新規登録したのに既存の同名案件がカレンダーに出る」不具合の原因になっていたため廃止。
            // 既存案件へ配置を追加したい場合は「既存案件から作成」経路（projectMasterId を指定＝上の
            // if 分岐）が担うので、新規作成側で名寄せする必要はない。
            const createMasterRes = await fetch('/api/project-masters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: project.title,
                    name: project.name,
                    honorific: project.honorific,
                    constructionSuffixId: project.constructionSuffixId,
                    siteShortName: project.siteShortName,
                    customerName: project.customer,
                    constructionType: project.constructionType || 'other',
                    constructionContent: project.constructionContent,
                    location: project.location,
                    description: project.description,
                    createdBy: project.createdBy,
                }),
            });
            if (!createMasterRes.ok) throw new Error('Failed to create project master');
            const newMaster = await createMasterRes.json();
            projectMasterId = newMaster.id;
            broadcastMasterId = newMaster.id; // 配置作成後にブロードキャストするためIDを保持
            // projectMasters ストアに追加
            const formatted = parseProjectMasterDates(newMaster);
            set((state) => ({
                projectMasters: [formatted, ...state.projectMasters],
            }));
        }

        type AssignmentApiResponse = Omit<ProjectAssignment, 'date' | 'createdAt' | 'updatedAt'> & {
            date: string; createdAt: string; updatedAt: string;
            projectMaster?: ProjectMaster & { createdAt: string; updatedAt: string };
        };

        const parseAssignmentResponse = (a: AssignmentApiResponse): ProjectAssignment & { projectMaster?: ProjectMaster } => ({
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
                constructionType: schedule.constructionType ?? project.constructionType,
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
            parsed.forEach((a: { id: string }) => newAssignmentIds.push(a.id));
            set((state) => {
                const newIds = new Set(parsed.map((a: { id: string }) => a.id));
                const filtered = state.assignments.filter(a => !newIds.has(a.id));
                return {
                    assignments: [...filtered, ...parsed],
                    projectMasters: state.projectMasters.map((pm) =>
                        pm.id === projectMasterId
                            ? { ...pm, assignmentCount: (pm.assignmentCount ?? 0) + parsed.length }
                            : pm
                    ),
                };
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
            newAssignmentIds.push(newAssignment.id);
            set((state) => ({
                assignments: [...state.assignments, parseAssignmentResponse(newAssignment)],
                projectMasters: state.projectMasters.map((pm) =>
                    pm.id === projectMasterId
                        ? { ...pm, assignmentCount: (pm.assignmentCount ?? 0) + 1 }
                        : pm
                ),
            }));
        }

        // 新規配置を別端末へ即時通知（postgres_changesの遅延を回避）
        if (newAssignmentIds.length === 1) {
            sendBroadcast('assignment_updated', { id: newAssignmentIds[0] });
        } else if (newAssignmentIds.length > 1) {
            sendBroadcast('assignments_batch_updated', { ids: newAssignmentIds });
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
            // ProjectMasterの更新が必要な場合（現在値と差分があるフィールドだけPATCH）
            // でないとPMの updatedAt が配置移動・編集のたびに触られてしまう
            if (assignment?.projectMasterId) {
                const currentPm = assignment.projectMaster ?? get().projectMasters.find(pm => pm.id === assignment.projectMasterId);
                const projectMasterUpdates: Record<string, unknown> = {};
                if (updates.title && updates.title !== currentPm?.title) {
                    projectMasterUpdates.title = updates.title;
                }
                if (updates.name !== undefined && (updates.name || null) !== (currentPm?.name ?? null)) {
                    projectMasterUpdates.name = updates.name || null;
                }
                if (updates.honorific !== undefined && (updates.honorific || null) !== (currentPm?.honorific ?? null)) {
                    projectMasterUpdates.honorific = updates.honorific || null;
                }
                if (updates.constructionSuffixId !== undefined && (updates.constructionSuffixId || null) !== (currentPm?.constructionSuffixId ?? null)) {
                    projectMasterUpdates.constructionSuffixId = updates.constructionSuffixId || null;
                }
                if (updates.siteShortName !== undefined && (updates.siteShortName || null) !== (currentPm?.siteShortName ?? null)) {
                    projectMasterUpdates.siteShortName = updates.siteShortName || null;
                }
                if (updates.createdBy && JSON.stringify(currentPm?.createdBy ?? null) !== JSON.stringify(updates.createdBy)) {
                    projectMasterUpdates.createdBy = updates.createdBy;
                }
                if (updates.constructionContent && updates.constructionContent !== currentPm?.constructionContent) {
                    projectMasterUpdates.constructionContent = updates.constructionContent;
                }

                if (Object.keys(projectMasterUpdates).length > 0) {
                    // 配置の副作用としての同期更新では、ProjectMaster.updatedAt を進めない。
                    // ユーザーが案件詳細を明示的に編集していないのに「最終更新日」が
                    // 変わると混乱を招くため、syncOnly フラグで raw SQL 更新に切り替える。
                    // ※この設計は意図的なので、通常の update に戻さないでください。
                    await fetch(`/api/project-masters/${assignment.projectMasterId}?syncOnly=true`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(projectMasterUpdates),
                    });
                }
            }

            // 職長または日付が変わった場合、手配確定を自動解除
            const isMoving = (updates.assignedEmployeeId && updates.assignedEmployeeId !== assignment?.assignedEmployeeId) ||
                (updates.startDate && formatDateKey(new Date(updates.startDate)) !== (assignment?.date ? formatDateKey(assignment.date) : ''));
            const dispatchConfirmed = isMoving ? false : updates.isDispatchConfirmed;
            const dispatchWorkerIds = isMoving ? [] : updates.confirmedWorkerIds;
            const dispatchVehicleIds = isMoving ? [] : updates.confirmedVehicleIds;

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
                    dispatchRemark: updates.dispatchRemark,
                    isDispatchConfirmed: dispatchConfirmed,
                    confirmedWorkerIds: dispatchWorkerIds,
                    confirmedVehicleIds: dispatchVehicleIds,
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
            set((state) => {
                const exists = state.assignments.some((a) => a.id === id);
                if (exists) {
                    // 在席時: 従来どおり置換（既存挙動を完全維持＝通常編集のデグレ回避）
                    return {
                        assignments: state.assignments.map((a) =>
                            a.id === id ? {
                                ...a,
                                ...updatedAssignment,
                                date: new Date(updatedAssignment.date),
                                createdAt: new Date(updatedAssignment.createdAt),
                                updatedAt: new Date(updatedAssignment.updatedAt),
                                projectMaster: updatedAssignment.projectMaster ? {
                                    ...updatedAssignment.projectMaster,
                                    createdAt: new Date(updatedAssignment.projectMaster.createdAt),
                                    updatedAt: new Date(updatedAssignment.projectMaster.updatedAt),
                                } : a.projectMaster,
                            } : a
                        ),
                    };
                }
                // 退避済み（週またぎ長押し移動）: 対象がストアに無いので応答配置を追加する。
                // 移動先セルは必ず現在表示中の週＝ロード範囲内なので、範囲外データの混入は起きない。
                // parse の流儀は fetchAssignments（このファイル冒頭）と揃える。
                const parsedUpdated = {
                    ...updatedAssignment,
                    date: new Date(updatedAssignment.date),
                    createdAt: new Date(updatedAssignment.createdAt),
                    updatedAt: new Date(updatedAssignment.updatedAt),
                    workStartedAt: updatedAssignment.workStartedAt ? new Date(updatedAssignment.workStartedAt) : null,
                    workEndedAt: updatedAssignment.workEndedAt ? new Date(updatedAssignment.workEndedAt) : null,
                    workStartedComment: updatedAssignment.workStartedComment ?? null,
                    workEndedComment: updatedAssignment.workEndedComment ?? null,
                    projectMaster: updatedAssignment.projectMaster ? {
                        ...updatedAssignment.projectMaster,
                        createdAt: new Date(updatedAssignment.projectMaster.createdAt),
                        updatedAt: new Date(updatedAssignment.projectMaster.updatedAt),
                    } : undefined,
                };
                return { assignments: [...state.assignments, parsedUpdated] };
            });
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

            // サーバーから返った updatedAt でストアを更新（楽観的ロック対策）
            const responseData = await response.json();
            if (responseData.results) {
                const updatedMap = new Map<string, { updatedAt: Date; updatedBy: string | null }>(responseData.results.map((r: { id: string; updatedAt: string; updatedBy?: string | null }) => [r.id, { updatedAt: new Date(r.updatedAt), updatedBy: r.updatedBy ?? null }]));
                set((state) => ({
                    assignments: state.assignments.map((a) => {
                        const updated = updatedMap.get(a.id);
                        return updated ? { ...a, updatedAt: updated.updatedAt, updatedBy: updated.updatedBy ?? undefined } : a;
                    }),
                }));
            }
        } catch (error) {
            if (!(error instanceof ConflictUpdateError)) {
                set({ assignments: previousAssignments });
            }
            throw error;
        }
    },

    deleteProject: async (id) => {
        const response = await fetch(`/api/assignments/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            throw new Error('Failed to delete assignment');
        }
        // 復元用の控え logId を取り出す（応答 body が無い/壊れていても削除自体は成功扱い）
        let logId: string | null = null;
        try {
            const data = await response.json();
            logId = (data && typeof data.logId === 'string') ? data.logId : null;
        } catch {
            logId = null;
        }
        set((state) => ({
            assignments: state.assignments.filter((a) => a.id !== id),
        }));
        return logId;
    },

    restoreAssignment: async (snapshot) => {
        // 誤削除のUndo: スナップショット（削除直前の配置）を /api/assignments で再作成する。
        // 案件マスタ（projectMaster）は削除されていないので、配置だけを作り直せばよい。
        // ※物理削除→再作成のため新しいIDになる。職方・車両・確認状態はスナップショットから復元する。
        const response = await fetch('/api/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectMasterId: snapshot.projectMasterId,
                assignedEmployeeId: snapshot.assignedEmployeeId,
                date: snapshot.date instanceof Date ? snapshot.date.toISOString() : snapshot.date,
                memberCount: snapshot.memberCount,
                workers: snapshot.workers,
                vehicles: snapshot.vehicles,
                meetingTime: snapshot.meetingTime,
                sortOrder: snapshot.sortOrder,
                remarks: snapshot.remarks,
                constructionType: snapshot.constructionType,
                estimatedHours: snapshot.estimatedHours,
                isDispatchConfirmed: snapshot.isDispatchConfirmed,
                confirmedWorkerIds: snapshot.confirmedWorkerIds,
                confirmedVehicleIds: snapshot.confirmedVehicleIds,
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to restore assignment');
        }

        const created = await response.json();
        const parsed = parseRestoredAssignment(created, snapshot.projectMaster);

        set((state) => ({
            assignments: [...state.assignments.filter((a) => a.id !== parsed.id), parsed],
            projectMasters: state.projectMasters.map((pm) =>
                pm.id === parsed.projectMasterId
                    ? { ...pm, assignmentCount: (pm.assignmentCount ?? 0) + 1 }
                    : pm
            ),
        }));

        return parsed;
    },

    restoreDeletedAssignment: async (logId) => {
        // サーバーの削除控え（DeletedAssignmentLog）から復元する。
        // 控えが「復元済み」になるため、変更履歴パネルとトーストUndoで二重復元が起きない。
        const response = await fetch('/api/assignments/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logId }),
        });

        if (!response.ok) {
            throw new Error('Failed to restore deleted assignment');
        }

        const created = await response.json();
        const parsed = parseRestoredAssignment(created);

        set((state) => ({
            assignments: [...state.assignments.filter((a) => a.id !== parsed.id), parsed],
            projectMasters: state.projectMasters.map((pm) =>
                pm.id === parsed.projectMasterId
                    ? { ...pm, assignmentCount: (pm.assignmentCount ?? 0) + 1 }
                    : pm
            ),
        }));

        return parsed;
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
