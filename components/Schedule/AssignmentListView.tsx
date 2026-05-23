'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useMasterData } from '@/hooks/useMasterData';
import { Project } from '@/types/calendar';
import ProjectModal from '@/components/Projects/ProjectModal';
import { formatDateKey } from '@/utils/employeeUtils';

type ProjectListItem = ReturnType<typeof useProjects>['projects'][0];

interface AssignmentListViewProps {
    selectedDate: Date;
    workerNameMap: Map<string, { displayName: string; isPartner: boolean; companyDisplayName: string | null; role: string | null }>;
    vehicleNameMap: Map<string, string>;
    isNamesLoaded: boolean;
    userRole?: string;
}

interface ManagerInfo { id: string; displayName: string }

/**
 * 一覧表示モード - 紙の作業日報に近いテーブル風レイアウト
 * 1案件1行のコンパクト表示で全体を俯瞰
 */
export default function AssignmentListView({
    selectedDate,
    workerNameMap,
    vehicleNameMap,
    isNamesLoaded,
    userRole,
}: AssignmentListViewProps) {
    const hidePartnerWorkers = userRole === 'foreman2';
    const { projects } = useProjects();
    const { displayedForemanIds, allForemen } = useCalendarDisplay();
    const { constructionTypes } = useMasterData();

    const [managerMap, setManagerMap] = useState<Map<string, string>>(new Map());
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);

    // 案件担当者の名前を取得
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await fetch('/api/users');
                if (!res.ok) return;
                const data: ManagerInfo[] = await res.json();
                const map = new Map<string, string>();
                data.forEach(u => map.set(u.id, u.displayName));
                setManagerMap(map);
            } catch { /* ignore */ }
        };
        fetchUsers();
    }, []);

    // 工事種別マップ(色)
    const ctMap = useMemo(() => {
        const m = new Map<string, { name: string; color: string }>();
        constructionTypes.forEach(ct => m.set(ct.id, { name: ct.name, color: ct.color }));
        return m;
    }, [constructionTypes]);

    // 職長の表示順マップ
    const foremanOrderMap = useMemo(() => {
        const m = new Map<string, number>();
        displayedForemanIds.forEach((id, idx) => m.set(id, idx));
        return m;
    }, [displayedForemanIds]);

    // 当日の案件をカレンダー順にソート
    const dateKey = formatDateKey(selectedDate);
    const sortedProjects = useMemo(() => {
        const dayProjects = projects.filter(p => {
            if (formatDateKey(new Date(p.startDate)) !== dateKey) return false;
            // 職長2 視点では協力業者班（assignedEmployeeId が isPartner=true）の案件を非表示。
            // カード表示モードと挙動を揃え、§3-3「協力業者の個人名は見せない」を遵守。
            if (hidePartnerWorkers && p.assignedEmployeeId) {
                const info = workerNameMap.get(p.assignedEmployeeId);
                if (info?.isPartner) return false;
            }
            return true;
        });
        return [...dayProjects].sort((a, b) => {
            const aFOrder = a.assignedEmployeeId ? (foremanOrderMap.get(a.assignedEmployeeId) ?? 9999) : 99999;
            const bFOrder = b.assignedEmployeeId ? (foremanOrderMap.get(b.assignedEmployeeId) ?? 9999) : 99999;
            if (aFOrder !== bFOrder) return aFOrder - bFOrder;
            return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        });
    }, [projects, dateKey, foremanOrderMap, hidePartnerWorkers, workerNameMap]);

    // 担当者表示名(姓のみ)
    const getShortManagerName = (id: string): string => {
        const full = managerMap.get(id) || '';
        if (!full) return '';
        const parts = full.split(/[\s　]+/);
        return parts[0] || full;
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-auto">
                {sortedProjects.length === 0 ? (
                    <div className="bg-white rounded-xl border border-slate-200 py-12 text-center text-slate-400 text-sm">
                        該当する案件はありません
                    </div>
                ) : (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        {/* テーブルヘッダー(スティッキー) */}
                        <div className="sticky top-0 z-10 grid grid-cols-[40px_1fr_96px] sm:grid-cols-[56px_1fr_140px] gap-2 px-2 sm:px-3 py-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <div className="text-center">担当</div>
                            <div>案件 / 職長</div>
                            <div className="text-right">人数 · 車両</div>
                        </div>

                        {/* 案件行 */}
                        <div>
                            {sortedProjects.map((p, idx) => {
                                const prev = idx > 0 ? sortedProjects[idx - 1] : null;
                                const sameForemanAsAbove = !!(prev && prev.assignedEmployeeId && prev.assignedEmployeeId === p.assignedEmployeeId);
                                const foremanChanged = !!(prev && prev.assignedEmployeeId !== p.assignedEmployeeId);
                                return (
                                    <React.Fragment key={p.id}>
                                        {/* 職長が変わったら余白行 */}
                                        {foremanChanged && (
                                            <div className="h-2 bg-slate-50 border-y border-slate-100" aria-hidden="true" />
                                        )}
                                        <AssignmentRow
                                            project={p}
                                            ctMap={ctMap}
                                            allForemen={allForemen}
                                            workerNameMap={workerNameMap}
                                            vehicleNameMap={vehicleNameMap}
                                            isNamesLoaded={isNamesLoaded}
                                            getShortManagerName={getShortManagerName}
                                            onClick={() => setSelectedProject(p as Project)}
                                            sameForemanAsAbove={sameForemanAsAbove}
                                            hidePartnerWorkers={hidePartnerWorkers}
                                        />
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* 詳細モーダル */}
            <ProjectModal
                isOpen={!!selectedProject}
                onClose={() => setSelectedProject(null)}
                onSubmit={() => {}}
                initialData={selectedProject ?? undefined}
                readOnly={true}
            />
        </div>
    );
}

// ── 案件1行(コンパクト) ───────────────────────────────────
interface AssignmentRowProps {
    project: ProjectListItem;
    ctMap: Map<string, { name: string; color: string }>;
    allForemen: { id: string; displayName: string }[];
    workerNameMap: Map<string, { displayName: string; isPartner: boolean; companyDisplayName: string | null; role: string | null }>;
    vehicleNameMap: Map<string, string>;
    isNamesLoaded: boolean;
    getShortManagerName: (id: string) => string;
    onClick: () => void;
    sameForemanAsAbove: boolean;
    hidePartnerWorkers?: boolean;
}

function AssignmentRow({
    project: p,
    ctMap,
    allForemen,
    workerNameMap,
    vehicleNameMap,
    isNamesLoaded,
    getShortManagerName,
    onClick,
    sameForemanAsAbove,
    hidePartnerWorkers,
}: AssignmentRowProps) {
    const foremanName = allForemen.find(f => f.id === p.assignedEmployeeId)?.displayName || '';
    const ctInfo = p.constructionType ? ctMap.get(p.constructionType) : null;
    const color = ctInfo?.color || p.color || '#475569';

    // 案件担当者
    const managerIds = Array.isArray(p.createdBy) ? p.createdBy : (p.createdBy ? [p.createdBy] : []);
    const managerLabel = managerIds.length === 0
        ? null
        : managerIds.length === 1
            ? getShortManagerName(managerIds[0])
            : managerIds.map(id => getShortManagerName(id)).join('・');

    // 車両名(短い表記)
    const vehicleNames = isNamesLoaded
        ? (p.confirmedVehicleIds && p.confirmedVehicleIds.length > 0
            ? p.confirmedVehicleIds.map(id => vehicleNameMap.get(id) || id)
            : (p.vehicles || []).map(id => vehicleNameMap.get(id) || id))
        : [];

    // メンバー名(職長を除く・もしあれば)
    const isVisibleMember = (id: string) => {
        if (id === p.assignedEmployeeId) return false;
        const info = workerNameMap.get(id);
        if (!info) return false;
        if (hidePartnerWorkers && info.isPartner) return false;
        return true;
    };
    const memberNames = isNamesLoaded
        ? (p.confirmedWorkerIds && p.confirmedWorkerIds.length > 0
            ? p.confirmedWorkerIds.filter(isVisibleMember).map(id => workerNameMap.get(id)!.displayName)
            : (p.workers || []).filter(isVisibleMember).map(id => workerNameMap.get(id)!.displayName))
        : [];

    const isUnassigned = !managerLabel;
    const isConfirmed = p.isDispatchConfirmed;

    return (
        <button
            onClick={onClick}
            className={`relative w-full text-left grid grid-cols-[40px_1fr_96px] sm:grid-cols-[56px_1fr_140px] gap-2 px-2 sm:px-3 py-1.5 hover:bg-slate-50 active:bg-slate-100 transition-colors border-b border-slate-100 last:border-b-0 ${
                isUnassigned ? 'bg-rose-50/40' : ''
            }`}
        >
            {/* 工事種別カラーバー(左端) */}
            <div
                className="absolute left-0 top-0 bottom-0 w-1"
                style={{ backgroundColor: color }}
                aria-hidden="true"
            />

            {/* 担当列 */}
            <div className="flex items-start justify-center pt-0.5">
                {isUnassigned ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-700 bg-rose-100 border border-rose-300 rounded px-1 py-0.5 leading-none">
                        <AlertCircle className="w-2.5 h-2.5" />
                        未
                    </span>
                ) : (
                    <span className="text-[12px] sm:text-[13px] font-bold text-slate-800 leading-tight truncate">
                        {managerLabel}
                    </span>
                )}
            </div>

            {/* 案件 + 職長 列 */}
            <div className="min-w-0">
                {/* 1段: 元請名 / 現場名 (色付き) */}
                <div className="flex items-baseline gap-1.5 flex-wrap">
                    {p.customer && (
                        <span
                            className="text-[12px] sm:text-[13px] font-semibold leading-tight"
                            style={{ color }}
                        >
                            {p.customer}
                        </span>
                    )}
                    <span
                        className="text-[14px] sm:text-[15px] font-bold leading-tight"
                        style={{ color }}
                    >
                        {p.title}
                    </span>
                    {isConfirmed && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    )}
                </div>

                {/* 2段: 職長 (+ メンバー) */}
                <div className="text-[11px] sm:text-[12px] text-slate-600 leading-tight mt-0.5 truncate">
                    <span className="text-slate-400">職長 </span>
                    {sameForemanAsAbove ? (
                        <span className="font-bold text-slate-500 tracking-widest">〃</span>
                    ) : foremanName ? (
                        <span className="font-medium text-slate-700">{foremanName}</span>
                    ) : (
                        <span className="text-slate-300 italic">未設定</span>
                    )}
                    {memberNames.length > 0 && (
                        <span className="ml-1.5 text-slate-500">
                            <span className="text-slate-400">/ </span>
                            {memberNames.join('・')}
                        </span>
                    )}
                </div>
            </div>

            {/* 人数・車両 列 */}
            <div className="text-right text-[11px] sm:text-[12px] leading-tight">
                {(p.memberCount ?? 0) > 0 && (
                    <div>
                        <span className="font-bold text-slate-800 text-[13px] sm:text-[14px]">{p.memberCount}</span>
                        <span className="text-slate-400 text-[10px] ml-0.5">名</span>
                    </div>
                )}
                {vehicleNames.length > 0 && (
                    <div className="text-slate-600 font-medium mt-0.5 break-words">
                        {vehicleNames.join('·')}
                    </div>
                )}
            </div>
        </button>
    );
}
