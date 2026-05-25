'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Project, DEFAULT_CONSTRUCTION_TYPE_COLORS, DEFAULT_CONSTRUCTION_TYPE_LABELS } from '@/types/calendar';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarStore } from '@/stores/calendarStore';
import ProjectMasterFilesView from '@/components/ProjectMaster/ProjectMasterFilesView';
import ScaffoldingSpecDisplay from '@/components/ProjectMaster/ScaffoldingSpecDisplay';
import WorkHistoryDisplay from '@/components/ProjectMaster/WorkHistoryDisplay';
import WorkStatusReportSection from './WorkStatusReportSection';
import WorkReportReplyThread, { WorkReportReplyItem } from '@/components/WorkReport/WorkReportReplyThread';
import { onBroadcast } from '@/lib/broadcastChannel';
import { ExternalLink, MessageSquare, Play, Square } from 'lucide-react';
import { logger } from '@/lib/logger';
import MapPreview from '@/components/ui/MapPreview';

const isCoordinates = (value: string) => /^-?[\d.]+,-?[\d.]+$/.test(value.trim());

interface ManagerUser {
    id: string;
    displayName: string;
}

interface ProjectDetailViewProps {
    project: Project;
    onClose: () => void;
    readOnly?: boolean;
}

export default function ProjectDetailView({ project, onClose, readOnly = false }: ProjectDetailViewProps) {
    const { data: session } = useSession();
    const userRole = session?.user?.role;
    const canEditAssignment = !readOnly && (userRole === 'admin' || userRole === 'manager');
    const canEditMemberCount = canEditAssignment;
    const canEditVehicles = canEditAssignment;
    const { updateProject } = useProjects();
    const [managerMap, setManagerMap] = useState<Record<string, string>>({});
    const [isLoadingManagers, setIsLoadingManagers] = useState(true);
    const [locationData, setLocationData] = useState<{
        prefecture?: string;
        city?: string;
        location?: string;
        plusCode?: string;
    } | null>(null);
    const [projectMasterRemarks, setProjectMasterRemarks] = useState<string>('');
    const { constructionTypes, vehicles } = useMasterData();
    const [workerMap, setWorkerMap] = useState<Record<string, string>>({});
    const [isLoadingWorkers, setIsLoadingWorkers] = useState(false);
    const [isSavingMemberCount, setIsSavingMemberCount] = useState(false);
    const [isEditingVehicles, setIsEditingVehicles] = useState(false);
    const [vehicleEditSelection, setVehicleEditSelection] = useState<string[]>([]);
    const [isSavingVehicles, setIsSavingVehicles] = useState(false);

    // ストアから最新の配置を購読（モーダルのinitialDataはクリック時のスナップショットなので古くなる）
    const liveAssignment = useCalendarStore((state) => state.assignments.find(a => a.id === project.id));
    const liveMemberCount = liveAssignment?.memberCount ?? project.memberCount ?? 0;
    const liveConfirmedCount = liveAssignment?.confirmedWorkerIds?.length ?? project.confirmedWorkerIds?.length ?? 0;
    const liveIsDispatchConfirmed = liveAssignment?.isDispatchConfirmed ?? project.isDispatchConfirmed ?? false;
    const remainingCount = Math.max(0, liveMemberCount - liveConfirmedCount);

    // 協力会社向け: 自分が担当 or 確定メンバーのときだけ作業開始/完了の報告セクションを表示
    // partner_member は自社班(companyId === assignedEmployeeId)のときに表示。応援先(他班)は除外
    const userId = session?.user?.id;
    const companyId = session?.user?.companyId ?? null;
    const liveAssignedEmployeeId = liveAssignment?.assignedEmployeeId ?? project.assignedEmployeeId;
    const liveConfirmedWorkerIds = liveAssignment?.confirmedWorkerIds ?? project.confirmedWorkerIds ?? [];
    const canReportWorkStatus =
        (userRole === 'partner' &&
            !!userId &&
            (liveAssignedEmployeeId === userId || liveConfirmedWorkerIds.includes(userId))) ||
        (userRole === 'partner_member' &&
            !!companyId &&
            liveAssignedEmployeeId === companyId);
    const liveWorkStartedAt = liveAssignment?.workStartedAt ?? project.workStartedAt ?? null;
    const liveWorkEndedAt = liveAssignment?.workEndedAt ?? project.workEndedAt ?? null;
    const liveWorkStartedComment = liveAssignment?.workStartedComment ?? project.workStartedComment ?? null;
    const liveWorkEndedComment = liveAssignment?.workEndedComment ?? project.workEndedComment ?? null;
    const hasWorkStatus = !!(liveWorkStartedAt || liveWorkEndedAt);

    const formatHHmm = (d: Date | string | null | undefined): string => {
        if (!d) return '';
        const date = d instanceof Date ? d : new Date(d);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    };

    // 返信スレッド用: 投稿権限 (admin/manager/担当職長本人/確定メンバー、partner_member は閲覧のみ)
    const isManager = userRole === 'admin' || userRole === 'manager';
    const isAssignedForeman = !!userId && liveAssignedEmployeeId === userId;
    const isConfirmedMember = !!userId && liveConfirmedWorkerIds.includes(userId);
    const canPostReply = isManager || isAssignedForeman || isConfirmedMember;

    // 返信一覧（個別 fetch・broadcast で同期）
    const [replies, setReplies] = useState<WorkReportReplyItem[]>([]);
    const [userNameMap, setUserNameMap] = useState<Map<string, string>>(new Map());

    const refetchReplies = useCallback(async () => {
        if (!hasWorkStatus) return;
        try {
            const res = await fetch(`/api/assignments/${project.id}/work-status/replies`, { cache: 'no-store' });
            if (res.ok) {
                const data: { replies: WorkReportReplyItem[] } = await res.json();
                setReplies(data.replies);
            }
        } catch (e) { /* ignore */ }
    }, [project.id, hasWorkStatus]);

    useEffect(() => {
        refetchReplies();
    }, [refetchReplies]);

    useEffect(() => {
        const fetchAllUsers = async () => {
            try {
                const res = await fetch('/api/users');
                if (res.ok) {
                    const users: { id: string; displayName: string }[] = await res.json();
                    setUserNameMap(new Map(users.map((u) => [u.id, u.displayName])));
                }
            } catch (e) { /* ignore */ }
        };
        fetchAllUsers();
    }, []);

    useEffect(() => {
        const cleanup = onBroadcast('work_report_reply_updated', (payload) => {
            if (payload?.assignmentId === project.id) {
                refetchReplies();
            }
        });
        return cleanup;
    }, [project.id, refetchReplies]);

    const commitMemberCount = async (next: number) => {
        const safe = Math.max(0, next);
        if (safe === liveMemberCount) return;
        setIsSavingMemberCount(true);
        try {
            await updateProject(project.id, { memberCount: safe });
        } catch (error) {
            logger.error('Failed to update memberCount:', error);
            toast.error('メンバー数の更新に失敗しました');
        } finally {
            setIsSavingMemberCount(false);
        }
    };

    // 現在の車両（手配確定済みなら confirmedVehicleIds の名前展開、なければ assignment.vehicles）
    const liveVehicleNames: string[] = useMemo(() => {
        const liveConfirmedVehicleIds = liveAssignment?.confirmedVehicleIds ?? project.confirmedVehicleIds ?? [];
        if (liveIsDispatchConfirmed && liveConfirmedVehicleIds.length > 0) {
            return liveConfirmedVehicleIds.map(id => vehicles.find(v => v.id === id)?.name || id);
        }
        return (liveAssignment?.vehicles ?? project.trucks ?? []) as string[];
    }, [liveAssignment?.confirmedVehicleIds, liveAssignment?.vehicles, project.confirmedVehicleIds, project.trucks, liveIsDispatchConfirmed, vehicles]);

    const startEditVehicles = () => {
        const currentNames = new Set(liveVehicleNames);
        const selectedIds = vehicles.filter(v => currentNames.has(v.name)).map(v => v.id);
        setVehicleEditSelection(selectedIds);
        setIsEditingVehicles(true);
    };

    const toggleVehicleInEdit = (id: string) => {
        setVehicleEditSelection(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const cancelEditVehicles = () => {
        setIsEditingVehicles(false);
    };

    const saveVehicles = async () => {
        setIsSavingVehicles(true);
        try {
            const selectedNames = vehicleEditSelection
                .map(id => vehicles.find(v => v.id === id)?.name)
                .filter((n): n is string => !!n);
            const updates: Partial<Project> = { vehicles: selectedNames };
            // 手配確定済みは confirmedVehicleIds も同期しないと、詳細表示の優先ソースが古いまま
            if (liveIsDispatchConfirmed) {
                updates.confirmedVehicleIds = vehicleEditSelection;
            }
            await updateProject(project.id, updates);
            setIsEditingVehicles(false);
        } catch (error) {
            logger.error('Failed to update vehicles:', error);
            toast.error('車両の更新に失敗しました');
        } finally {
            setIsSavingVehicles(false);
        }
    };

    // 手配確定メンバー名を取得
    useEffect(() => {
        if (!project.isDispatchConfirmed || !project.confirmedWorkerIds?.length) return;
        setIsLoadingWorkers(true);
        fetch('/api/dispatch/workers', { cache: 'no-store' })
            .then(res => res.ok ? res.json() : [])
            .then((workers: { id: string; displayName: string }[]) => {
                const map: Record<string, string> = {};
                workers.forEach(w => { map[w.id] = w.displayName; });
                setWorkerMap(map);
            })
            .catch(() => {})
            .finally(() => setIsLoadingWorkers(false));
    }, [project.isDispatchConfirmed, project.confirmedWorkerIds]);

    // 工事種別の色と名前を取得
    const constructionTypeInfo = useMemo(() => {
        const ct = project.constructionType;
        if (!ct) {
            return { color: '#a8c8e8', label: '未設定' };
        }
        // マスターデータから検索（IDまたはレガシーコード）
        const masterType = constructionTypes.find(t => t.id === ct || t.name === ct);
        if (masterType) {
            return { color: masterType.color, label: masterType.name };
        }
        // デフォルト値（後方互換性）
        return {
            color: DEFAULT_CONSTRUCTION_TYPE_COLORS[ct] || '#a8c8e8',
            label: DEFAULT_CONSTRUCTION_TYPE_LABELS[ct] || ct,
        };
    }, [project.constructionType, constructionTypes]);

    // 案件担当者を配列として扱う
    const managers = Array.isArray(project.createdBy)
        ? project.createdBy
        : project.createdBy
            ? [project.createdBy]
            : [];

    // マネージャー名を取得
    useEffect(() => {
        const fetchManagers = async () => {
            try {
                const res = await fetch('/api/users');
                if (res.ok) {
                    const data = await res.json();
                    const map: Record<string, string> = {};
                    data.forEach((user: ManagerUser) => {
                        map[user.id] = user.displayName;
                    });
                    setManagerMap(map);
                }
            } catch {
                logger.error('担当者名の取得に失敗しました');
            } finally {
                setIsLoadingManagers(false);
            }
        };
        if (managers.length > 0) {
            fetchManagers();
        } else {
            setIsLoadingManagers(false);
        }
    }, [managers.length]);

    // 案件マスターの住所情報を取得
    useEffect(() => {
        if (!project.projectMasterId) return;
        fetch(`/api/project-masters/${project.projectMasterId}`, { cache: 'no-store' })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data) {
                    setLocationData({
                        prefecture: data.prefecture,
                        city: data.city,
                        location: data.location,
                        plusCode: data.plusCode,
                    });
                    setProjectMasterRemarks(data.remarks || '');
                }
            })
            .catch(() => {});
    }, [project.projectMasterId]);

    // ステータスの表示設定
    const statusConfig = {
        confirmed: { label: '確定', color: 'bg-slate-100 text-slate-700' },
        pending: { label: '保留', color: 'bg-slate-100 text-slate-600' },
        completed: { label: '完了', color: 'bg-slate-100 text-slate-700' },
        cancelled: { label: '中止', color: 'bg-slate-100 text-slate-700' },
    };

    const status = project.status ? statusConfig[project.status] : null;

    return (
        <div className="space-y-6">
            {/* ヘッダー情報 */}
            <div className="border-b border-slate-200 pb-4">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <h3 className="text-2xl font-bold text-slate-900">{project.title}</h3>
                        {project.customer && (
                            <p className="text-lg text-slate-600 mt-1">{project.customer}</p>
                        )}
                    </div>
                    {status && (
                        <span className={`px-3 py-1 text-sm rounded-full font-medium ${status.color}`}>
                            {status.label}
                        </span>
                    )}
                </div>
            </div>

            {/* 作業時間の報告（協力会社のみ） */}
            {canReportWorkStatus && (
                <WorkStatusReportSection
                    assignmentId={project.id}
                    projectMasterId={project.projectMasterId}
                    title={project.title}
                    workStartedAt={liveWorkStartedAt}
                    workEndedAt={liveWorkEndedAt}
                />
            )}

            {/* 作業状況（開始/完了が押されていれば全員に表示） */}
            {hasWorkStatus && (
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">作業状況</label>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                        {liveWorkStartedAt && (
                            <div>
                                <div className="flex items-start gap-2">
                                    <Play className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-slate-800">
                                            作業開始 <span className="text-slate-500 font-normal">（{formatHHmm(liveWorkStartedAt)}）</span>
                                        </div>
                                        {liveWorkStartedComment && (
                                            <div className="mt-1 flex items-start gap-1.5 text-xs">
                                                <MessageSquare className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                                                <div>
                                                    <span className="text-slate-500">開始時のひとこと: </span>
                                                    <span className="text-slate-700 whitespace-pre-wrap break-words">{liveWorkStartedComment}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <WorkReportReplyThread
                                    assignmentId={project.id}
                                    reportType="start"
                                    replies={replies.filter((r) => r.reportType === 'start')}
                                    currentUserId={userId ?? ''}
                                    canPost={canPostReply}
                                    canDeleteAll={isManager}
                                    userNameMap={userNameMap}
                                    onChanged={refetchReplies}
                                />
                            </div>
                        )}
                        {liveWorkEndedAt && (
                            <div>
                                <div className="flex items-start gap-2">
                                    <Square className="w-4 h-4 text-slate-700 flex-shrink-0 mt-0.5" />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-slate-800">
                                            作業完了 <span className="text-slate-500 font-normal">（{formatHHmm(liveWorkEndedAt)}）</span>
                                        </div>
                                        {liveWorkEndedComment && (
                                            <div className="mt-1 flex items-start gap-1.5 text-xs">
                                                <MessageSquare className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                                                <div>
                                                    <span className="text-slate-500">完了時のひとこと: </span>
                                                    <span className="text-slate-700 whitespace-pre-wrap break-words">{liveWorkEndedComment}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <WorkReportReplyThread
                                    assignmentId={project.id}
                                    reportType="end"
                                    replies={replies.filter((r) => r.reportType === 'end')}
                                    currentUserId={userId ?? ''}
                                    canPost={canPostReply}
                                    canDeleteAll={isManager}
                                    userNameMap={userNameMap}
                                    onChanged={refetchReplies}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 詳細情報 */}
            <div className="space-y-4">
                {/* 案件担当者 */}
                {managers.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            案件担当者
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {isLoadingManagers ? (
                                <span className="text-sm text-slate-500">読み込み中...</span>
                            ) : (
                                managers.filter(manager => managerMap[manager]).map((manager, index) => (
                                    <span
                                        key={index}
                                        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700"
                                    >
                                        {managerMap[manager]}
                                    </span>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* 工事種別 */}
                {project.constructionType && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            工事種別
                        </label>
                        <span
                            className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium text-slate-900"
                            style={{
                                backgroundColor: `${constructionTypeInfo.color}30`,
                                border: `2px solid ${constructionTypeInfo.color}`
                            }}
                        >
                            {constructionTypeInfo.label}
                        </span>
                    </div>
                )}

                {/* メンバー数 */}
                {(canEditMemberCount || liveMemberCount > 0 || (project.workers && project.workers.length > 0)) && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            メンバー数
                        </label>
                        {canEditMemberCount ? (
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                    </svg>
                                    <button
                                        type="button"
                                        onClick={() => commitMemberCount(liveMemberCount - 1)}
                                        disabled={isSavingMemberCount || liveMemberCount <= 0}
                                        className="w-10 h-10 flex items-center justify-center border border-slate-300 rounded-xl text-slate-700 active:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-lg"
                                        aria-label="メンバー数を減らす"
                                    >
                                        −
                                    </button>
                                    <span className="min-w-[3.5rem] text-center text-lg font-semibold text-slate-900">
                                        {liveMemberCount}名
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => commitMemberCount(liveMemberCount + 1)}
                                        disabled={isSavingMemberCount}
                                        className="w-10 h-10 flex items-center justify-center border border-slate-300 rounded-xl text-slate-700 active:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-lg"
                                        aria-label="メンバー数を増やす"
                                    >
                                        ＋
                                    </button>
                                </div>
                                {liveIsDispatchConfirmed && (
                                    <span
                                        className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                                            remainingCount === 0
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-amber-100 text-amber-800'
                                        }`}
                                    >
                                        確定 {liveConfirmedCount}名 / 残り {remainingCount}名
                                    </span>
                                )}
                                {isSavingMemberCount && (
                                    <span className="text-xs text-slate-500">保存中...</span>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                    </svg>
                                    <span className="text-base text-slate-900 font-medium">{liveMemberCount}名</span>
                                </div>
                                {liveIsDispatchConfirmed && (
                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700">
                                        確定 {liveConfirmedCount}名 / 残り {remainingCount}名
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* 手配確定メンバー */}
                {project.isDispatchConfirmed && project.confirmedWorkerIds && project.confirmedWorkerIds.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            手配確定メンバー
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {isLoadingWorkers ? (
                                <span className="text-sm text-slate-500">読み込み中...</span>
                            ) : (
                                project.confirmedWorkerIds.filter(id => workerMap[id]).map((id) => (
                                    <span
                                        key={id}
                                        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800"
                                    >
                                        {workerMap[id]}
                                    </span>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* 車両（手配確定時の車両を優先、なければ登録時の車両） */}
                {(canEditVehicles || liveVehicleNames.length > 0) && (
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-slate-700">
                                車両
                            </label>
                            {canEditVehicles && !isEditingVehicles && (
                                <button
                                    type="button"
                                    onClick={startEditVehicles}
                                    className="text-xs px-2.5 py-1 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
                                >
                                    編集
                                </button>
                            )}
                        </div>
                        {isEditingVehicles ? (
                            <div className="space-y-2">
                                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto border border-slate-200 rounded-xl p-3">
                                    {vehicles.length === 0 ? (
                                        <span className="text-sm text-slate-400">車両マスタが未登録です</span>
                                    ) : (
                                        vehicles.map(vehicle => (
                                            <label
                                                key={vehicle.id}
                                                className="flex items-center gap-2 p-2 rounded text-sm cursor-pointer hover:bg-slate-50"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={vehicleEditSelection.includes(vehicle.id)}
                                                    onChange={() => toggleVehicleInEdit(vehicle.id)}
                                                    className="w-4 h-4 shrink-0 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                                />
                                                <span className="text-slate-700">{vehicle.name}</span>
                                            </label>
                                        ))
                                    )}
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                    {isSavingVehicles && (
                                        <span className="text-xs text-slate-500 mr-1">保存中...</span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={cancelEditVehicles}
                                        disabled={isSavingVehicles}
                                        className="px-3 py-1.5 text-sm border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        type="button"
                                        onClick={saveVehicles}
                                        disabled={isSavingVehicles}
                                        className="px-3 py-1.5 text-sm border border-slate-700 bg-slate-700 text-white rounded-xl hover:bg-slate-800 disabled:opacity-40"
                                    >
                                        保存
                                    </button>
                                </div>
                            </div>
                        ) : liveVehicleNames.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {liveVehicleNames.map((name, index) => (
                                    <span
                                        key={index}
                                        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-800"
                                    >
                                        <svg className="w-4 h-4 mr-1.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        {name}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <span className="text-sm text-slate-400">未選択</span>
                        )}
                    </div>
                )}

                {/* 地図 */}
                {locationData && (() => {
                    const mapQuery = (() => {
                        if (locationData.plusCode && isCoordinates(locationData.plusCode)) return locationData.plusCode;
                        const parts = [locationData.prefecture, locationData.city, locationData.location].filter(Boolean);
                        return parts.join('');
                    })();
                    if (!mapQuery) return null;
                    const googleMapsUrl = isCoordinates(mapQuery)
                        ? `https://www.google.com/maps?q=${mapQuery}`
                        : `https://www.google.com/maps/search/${encodeURIComponent(mapQuery)}`;
                    return (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-slate-700">所在地</label>
                                <a
                                    href={googleMapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800 transition-colors"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Google Mapsで開く
                                </a>
                            </div>
                            {(() => {
                                const cityLocation = [locationData.city, locationData.location].filter(Boolean).join('-');
                                const addressParts = [locationData.prefecture, cityLocation].filter(Boolean);
                                return addressParts.length > 0 ? (
                                    <p className="text-sm text-slate-700 mb-2">{addressParts.join(' ')}</p>
                                ) : null;
                            })()}
                            <MapPreview mapQuery={mapQuery} height={220} />
                        </div>
                    );
                })()}

                {/* 開始日 */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        日付
                    </label>
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-base text-slate-900">
                            {project.startDate.toLocaleDateString('ja-JP', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                weekday: 'short'
                            })}
                        </span>
                    </div>
                </div>

                {/* 備考 */}
                {project.remarks && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            備考
                        </label>
                        <div className="bg-slate-50 rounded-md p-3 border border-slate-200">
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{project.remarks}</p>
                        </div>
                    </div>
                )}

                {/* 足場仕様 */}
                {project.projectMasterId && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            足場仕様
                        </label>
                        <ScaffoldingSpecDisplay projectMasterId={project.projectMasterId} />
                    </div>
                )}

                {/* 案件備考（案件登録時の備考） */}
                {projectMasterRemarks && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            案件備考
                        </label>
                        <div className="bg-slate-50 rounded-md p-3 border border-slate-200">
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{projectMasterRemarks}</p>
                        </div>
                    </div>
                )}

                {/* 画像フォルダ */}
                {project.projectMasterId && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            画像フォルダ
                        </label>
                        <ProjectMasterFilesView projectMasterId={project.projectMasterId} />
                    </div>
                )}

                {/* 作業履歴 */}
                {project.projectMasterId && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            作業履歴
                        </label>
                        <WorkHistoryDisplay projectMasterId={project.projectMasterId} />
                    </div>
                )}
            </div>

            {/* 閉じるボタン */}
            <div className="pt-4 border-t border-slate-200">
                <button
                    onClick={onClose}
                    className="w-full px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors font-medium"
                >
                    閉じる
                </button>
            </div>
        </div>
    );
}
