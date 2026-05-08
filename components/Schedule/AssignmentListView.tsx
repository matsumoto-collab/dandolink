'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Users, Truck, AlertCircle } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useMasterData } from '@/hooks/useMasterData';
import { Project } from '@/types/calendar';
import ProjectModal from '@/components/Projects/ProjectModal';
import { formatDateKey } from '@/utils/employeeUtils';

type ProjectListItem = ReturnType<typeof useProjects>['projects'][0];

interface AssignmentListViewProps {
    selectedDate: Date;
    workerNameMap: Map<string, string>;
    vehicleNameMap: Map<string, string>;
    isNamesLoaded: boolean;
}

interface ManagerInfo { id: string; displayName: string }

/**
 * 一覧表示モード - カレンダー順(職長→順番)でフラット表示
 * 紙の手配表に近いレイアウト。モバイル優先。
 */
export default function AssignmentListView({
    selectedDate,
    workerNameMap,
    vehicleNameMap,
    isNamesLoaded,
}: AssignmentListViewProps) {
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
            } catch {
                // 失敗時はIDをそのまま表示
            }
        };
        fetchUsers();
    }, []);

    // 工事種別マップ(色)
    const ctMap = useMemo(() => {
        const m = new Map<string, { name: string; color: string }>();
        constructionTypes.forEach(ct => m.set(ct.id, { name: ct.name, color: ct.color }));
        return m;
    }, [constructionTypes]);

    // 職長の表示順マップ(カレンダーの並び順)
    const foremanOrderMap = useMemo(() => {
        const m = new Map<string, number>();
        displayedForemanIds.forEach((id, idx) => m.set(id, idx));
        return m;
    }, [displayedForemanIds]);

    // 当日の案件をカレンダー順にソート
    const dateKey = formatDateKey(selectedDate);
    const sortedProjects = useMemo(() => {
        const dayProjects = projects.filter(p => formatDateKey(new Date(p.startDate)) === dateKey);
        return [...dayProjects].sort((a, b) => {
            const aFOrder = a.assignedEmployeeId ? (foremanOrderMap.get(a.assignedEmployeeId) ?? 9999) : 99999;
            const bFOrder = b.assignedEmployeeId ? (foremanOrderMap.get(b.assignedEmployeeId) ?? 9999) : 99999;
            if (aFOrder !== bFOrder) return aFOrder - bFOrder;
            return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        });
    }, [projects, dateKey, foremanOrderMap]);

    // 担当者表示名(短縮: 姓のみ)
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
                    <div className="bg-white rounded-2xl border border-slate-200 py-12 text-center text-slate-400 text-sm">
                        該当する案件はありません
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {sortedProjects.map((p, idx) => {
                            const prev = idx > 0 ? sortedProjects[idx - 1] : null;
                            const sameForemanAsAbove = !!(prev && prev.assignedEmployeeId && prev.assignedEmployeeId === p.assignedEmployeeId);
                            const foremanChanged = !!(prev && prev.assignedEmployeeId !== p.assignedEmployeeId);
                            return (
                                <AssignmentRow
                                    key={p.id}
                                    project={p}
                                    allForemen={allForemen}
                                    workerNameMap={workerNameMap}
                                    vehicleNameMap={vehicleNameMap}
                                    isNamesLoaded={isNamesLoaded}
                                    ctMap={ctMap}
                                    getShortManagerName={getShortManagerName}
                                    onClick={() => setSelectedProject(p as Project)}
                                    sameForemanAsAbove={sameForemanAsAbove}
                                    foremanChanged={foremanChanged}
                                    isFirst={idx === 0}
                                />
                            );
                        })}
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

// ── 案件1行(カード) ───────────────────────────────────────
interface AssignmentRowProps {
    project: ProjectListItem;
    allForemen: { id: string; displayName: string }[];
    workerNameMap: Map<string, string>;
    vehicleNameMap: Map<string, string>;
    isNamesLoaded: boolean;
    ctMap: Map<string, { name: string; color: string }>;
    getShortManagerName: (id: string) => string;
    onClick: () => void;
    sameForemanAsAbove: boolean;
    foremanChanged: boolean;
    isFirst: boolean;
}

function AssignmentRow({
    project: p,
    allForemen,
    workerNameMap,
    vehicleNameMap,
    isNamesLoaded,
    ctMap,
    getShortManagerName,
    onClick,
    sameForemanAsAbove,
    foremanChanged,
    isFirst,
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

    // メンバー名(職長を除く)
    const memberNames = isNamesLoaded
        ? (p.confirmedWorkerIds && p.confirmedWorkerIds.length > 0
            ? p.confirmedWorkerIds
                .filter(id => id !== p.assignedEmployeeId && workerNameMap.has(id))
                .map(id => workerNameMap.get(id)!)
            : (p.workers || [])
                .filter(id => id !== p.assignedEmployeeId && workerNameMap.has(id))
                .map(id => workerNameMap.get(id)!))
        : [];

    // 車両名
    const vehicleNames = isNamesLoaded
        ? (p.confirmedVehicleIds && p.confirmedVehicleIds.length > 0
            ? p.confirmedVehicleIds.map(id => vehicleNameMap.get(id) || id)
            : (p.vehicles || []).map(id => vehicleNameMap.get(id) || id))
        : [];

    const isUnassigned = !managerLabel;
    const isConfirmed = p.isDispatchConfirmed;

    return (
        <>
            {/* 職長が変わったら区切りスペース */}
            {foremanChanged && !isFirst && <div className="h-2" aria-hidden="true" />}

            <button
                onClick={onClick}
                className={`relative w-full text-left bg-white hover:bg-slate-50 active:bg-slate-100 transition-all rounded-2xl border shadow-sm overflow-hidden min-h-[88px] ${
                    isUnassigned
                        ? 'border-rose-200 ring-1 ring-rose-200'
                        : 'border-slate-200'
                }`}
            >
                {/* 左の縦カラーバー(工事種別) */}
                <div
                    className="absolute left-0 top-0 bottom-0 w-1.5"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                />

                <div className="pl-4 pr-3 py-3 flex gap-3">
                    {/* 担当エリア */}
                    <div className="flex-shrink-0 w-[52px] sm:w-[64px] flex flex-col items-center justify-start pt-0.5">
                        {isUnassigned ? (
                            <div className="inline-flex flex-col items-center gap-0.5 px-1.5 py-1 bg-rose-50 border border-rose-300 rounded-lg">
                                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                                <span className="text-[10px] font-bold text-rose-700 leading-none">未割当</span>
                            </div>
                        ) : (
                            <div className="inline-flex items-center justify-center px-2 py-1 bg-slate-100 border border-slate-200 rounded-lg min-w-full">
                                <span className="text-[13px] sm:text-[14px] font-bold text-slate-800 leading-none truncate">
                                    {managerLabel}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* 右の本体 */}
                    <div className="flex-1 min-w-0">
                        {/* 上段: 元請名 + 確定マーク */}
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                {p.customer && (
                                    <div
                                        className="text-[12px] sm:text-[13px] font-semibold leading-tight truncate"
                                        style={{ color }}
                                    >
                                        {p.customer}
                                    </div>
                                )}
                                {/* 現場名(大きく目立たせる) */}
                                <div
                                    className="text-[16px] sm:text-[17px] font-bold leading-snug break-words mt-0.5"
                                    style={{ color }}
                                >
                                    {p.title}
                                </div>
                            </div>
                            {isConfirmed && (
                                <div className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-full mt-0.5">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                    <span className="text-[10px] font-bold text-emerald-700 leading-none">確定</span>
                                </div>
                            )}
                        </div>

                        {/* 区切り */}
                        <div className="mt-2 pt-2 border-t border-slate-100">
                            {/* 中段: 職長(目立つ) */}
                            <div className="flex items-center gap-2 text-[13px] sm:text-[14px]">
                                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">職長</span>
                                {sameForemanAsAbove ? (
                                    <span className="text-slate-400 font-bold tracking-widest text-[16px]">〃</span>
                                ) : foremanName ? (
                                    <span className="font-semibold text-slate-800">{foremanName}</span>
                                ) : (
                                    <span className="text-slate-300 italic">未設定</span>
                                )}
                            </div>

                            {/* 下段: 人数 + 車両 */}
                            {((p.memberCount ?? 0) > 0 || vehicleNames.length > 0) && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] sm:text-[13px] text-slate-700">
                                    {(p.memberCount ?? 0) > 0 && (
                                        <span className="inline-flex items-center gap-1">
                                            <Users className="w-3.5 h-3.5 text-slate-400" />
                                            <span className="font-semibold">{p.memberCount}</span>
                                            <span className="text-slate-500 text-[11px]">名</span>
                                        </span>
                                    )}
                                    {vehicleNames.length > 0 && (
                                        <span className="inline-flex items-center gap-1 min-w-0">
                                            <Truck className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                            <span className="font-semibold truncate">
                                                {vehicleNames.join('・')}
                                            </span>
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* メンバー(あれば) */}
                            {memberNames.length > 0 && (
                                <div className="mt-1.5 text-[11px] sm:text-[12px] text-slate-500 break-words leading-relaxed">
                                    <span className="text-slate-400">メンバー: </span>
                                    {memberNames.join('・')}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </button>
        </>
    );
}
