'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Users, Truck, AlertTriangle } from 'lucide-react';
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
 * 一覧表示モード - 旧手配表(作業日報)に近いテーブル風レイアウト
 * モバイル優先。担当者ごとにグルーピング、職長間に余白
 */
export default function AssignmentListView({
    selectedDate,
    workerNameMap,
    vehicleNameMap,
    isNamesLoaded,
}: AssignmentListViewProps) {
    const { projects } = useProjects();
    const { allForemen } = useCalendarDisplay();
    const { constructionTypes } = useMasterData();

    const [managerMap, setManagerMap] = useState<Map<string, string>>(new Map());
    const [allManagers, setAllManagers] = useState<ManagerInfo[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);

    // フィルター state
    const [managerFilter, setManagerFilter] = useState<string>('all'); // 'all' | userId | 'unassigned'
    const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set()); // 空 = 全表示

    // 担当者(管理者・マネージャー・職長)の名前を取得
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await fetch('/api/users');
                if (!res.ok) return;
                const data: ManagerInfo[] = await res.json();
                const map = new Map<string, string>();
                data.forEach(u => map.set(u.id, u.displayName));
                setManagerMap(map);
                setAllManagers(data);
            } catch {
                // 失敗時はIDをそのまま表示
            }
        };
        fetchUsers();
    }, []);

    // 工事種別マップ(色とラベル)
    const ctMap = useMemo(() => {
        const m = new Map<string, { name: string; color: string }>();
        constructionTypes.forEach(ct => m.set(ct.id, { name: ct.name, color: ct.color }));
        return m;
    }, [constructionTypes]);

    // 当日の案件を担当者ごとにグルーピング
    const dateKey = formatDateKey(selectedDate);
    const dayProjects = useMemo(() => {
        return projects.filter(p => formatDateKey(new Date(p.startDate)) === dateKey);
    }, [projects, dateKey]);

    // 工事種別フィルター適用
    const filteredProjects = useMemo(() => {
        let result = dayProjects;
        if (typeFilters.size > 0) {
            result = result.filter(p => p.constructionType && typeFilters.has(p.constructionType));
        }
        if (managerFilter !== 'all') {
            if (managerFilter === 'unassigned') {
                result = result.filter(p => {
                    const ids = Array.isArray(p.createdBy) ? p.createdBy : (p.createdBy ? [p.createdBy] : []);
                    return ids.length === 0;
                });
            } else {
                result = result.filter(p => {
                    const ids = Array.isArray(p.createdBy) ? p.createdBy : (p.createdBy ? [p.createdBy] : []);
                    return ids.includes(managerFilter);
                });
            }
        }
        return result;
    }, [dayProjects, typeFilters, managerFilter]);

    // 当日案件に登場する担当者のID一覧(フィルターチップ用)
    const managersInUse = useMemo(() => {
        const ids = new Set<string>();
        dayProjects.forEach(p => {
            const arr = Array.isArray(p.createdBy) ? p.createdBy : (p.createdBy ? [p.createdBy] : []);
            arr.forEach(id => ids.add(id));
        });
        return Array.from(ids)
            .map(id => allManagers.find(u => u.id === id) || { id, displayName: managerMap.get(id) || id })
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
    }, [dayProjects, allManagers, managerMap]);

    // 担当者ごとにグループ化(複数担当者の場合は最初のIDを使う)
    const groupedByManager = useMemo(() => {
        const groups = new Map<string, ProjectListItem[]>();
        const unassigned: ProjectListItem[] = [];

        filteredProjects.forEach(p => {
            const ids = Array.isArray(p.createdBy) ? p.createdBy : (p.createdBy ? [p.createdBy] : []);
            if (ids.length === 0) {
                unassigned.push(p);
                return;
            }
            // 最初の担当者をプライマリーとして使用
            const primary = ids[0];
            if (!groups.has(primary)) groups.set(primary, []);
            groups.get(primary)!.push(p);
        });

        // 各グループ内を職長→順番でソート
        groups.forEach(arr => {
            arr.sort((a, b) => {
                const fa = a.assignedEmployeeId || '';
                const fb = b.assignedEmployeeId || '';
                if (fa !== fb) return fa.localeCompare(fb);
                return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
            });
        });

        // 担当者IDを表示名順にソート
        const orderedIds = Array.from(groups.keys()).sort((a, b) => {
            const an = managerMap.get(a) || a;
            const bn = managerMap.get(b) || b;
            return an.localeCompare(bn, 'ja');
        });

        return {
            groups: orderedIds.map(id => ({ managerId: id, items: groups.get(id)! })),
            unassigned,
        };
    }, [filteredProjects, managerMap]);

    // 工事種別フィルターのトグル
    const toggleTypeFilter = (typeId: string) => {
        setTypeFilters(prev => {
            const next = new Set(prev);
            if (next.has(typeId)) next.delete(typeId);
            else next.add(typeId);
            return next;
        });
    };

    // ── レンダリング ──────────────────────────────────────────
    const totalCount = filteredProjects.length;

    return (
        <div className="flex flex-col h-full gap-3">
            {/* フィルター行 */}
            <div className="flex-shrink-0 bg-white rounded-xl border border-slate-200 p-3 space-y-2.5">
                {/* 担当者フィルター */}
                <div>
                    <div className="text-[11px] font-medium text-slate-500 mb-1.5">案件担当者</div>
                    <div className="flex flex-wrap gap-1.5">
                        <FilterChip
                            label="全員"
                            active={managerFilter === 'all'}
                            onClick={() => setManagerFilter('all')}
                        />
                        {managersInUse.map(m => (
                            <FilterChip
                                key={m.id}
                                label={m.displayName}
                                active={managerFilter === m.id}
                                onClick={() => setManagerFilter(m.id)}
                            />
                        ))}
                        {dayProjects.some(p => {
                            const ids = Array.isArray(p.createdBy) ? p.createdBy : (p.createdBy ? [p.createdBy] : []);
                            return ids.length === 0;
                        }) && (
                            <FilterChip
                                label="未割当"
                                active={managerFilter === 'unassigned'}
                                onClick={() => setManagerFilter('unassigned')}
                                warning
                            />
                        )}
                    </div>
                </div>

                {/* 工事種別フィルター(色凡例) */}
                {constructionTypes.length > 0 && (
                    <div>
                        <div className="text-[11px] font-medium text-slate-500 mb-1.5">
                            工事種別 {typeFilters.size > 0 && (
                                <button
                                    onClick={() => setTypeFilters(new Set())}
                                    className="ml-1.5 text-[10px] text-slate-400 underline"
                                >
                                    クリア
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {constructionTypes.map(ct => {
                                const active = typeFilters.size === 0 || typeFilters.has(ct.id);
                                return (
                                    <button
                                        key={ct.id}
                                        onClick={() => toggleTypeFilter(ct.id)}
                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium transition-all ${
                                            active ? 'shadow-sm' : 'opacity-40'
                                        }`}
                                        style={{
                                            backgroundColor: active ? `${ct.color}25` : '#f8fafc',
                                            borderColor: ct.color,
                                            color: '#1e293b',
                                        }}
                                    >
                                        <span
                                            className="inline-block w-2.5 h-2.5 rounded-full"
                                            style={{ backgroundColor: ct.color }}
                                        />
                                        {ct.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="text-[11px] text-slate-400 pt-0.5">
                    {totalCount}件表示中
                </div>
            </div>

            {/* テーブル本体 */}
            <div className="flex-1 overflow-auto">
                {totalCount === 0 && groupedByManager.unassigned.length === 0 ? (
                    <div className="bg-white rounded-xl border border-slate-200 py-10 text-center text-slate-400 text-sm">
                        該当する案件はありません
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* 担当者ごとのテーブル */}
                        {groupedByManager.groups.map(({ managerId, items }) => (
                            <ManagerSection
                                key={managerId}
                                managerName={managerMap.get(managerId) || managerId}
                                items={items}
                                allForemen={allForemen}
                                workerNameMap={workerNameMap}
                                vehicleNameMap={vehicleNameMap}
                                isNamesLoaded={isNamesLoaded}
                                ctMap={ctMap}
                                onProjectClick={(p) => setSelectedProject(p as Project)}
                            />
                        ))}

                        {/* 未割当セクション */}
                        {groupedByManager.unassigned.length > 0 && managerFilter !== 'unassigned' && managerFilter === 'all' && (
                            <ManagerSection
                                managerName="担当者未割当"
                                items={groupedByManager.unassigned}
                                allForemen={allForemen}
                                workerNameMap={workerNameMap}
                                vehicleNameMap={vehicleNameMap}
                                isNamesLoaded={isNamesLoaded}
                                ctMap={ctMap}
                                onProjectClick={(p) => setSelectedProject(p as Project)}
                                isWarning
                            />
                        )}
                        {managerFilter === 'unassigned' && groupedByManager.unassigned.length > 0 && (
                            <ManagerSection
                                managerName="担当者未割当"
                                items={groupedByManager.unassigned}
                                allForemen={allForemen}
                                workerNameMap={workerNameMap}
                                vehicleNameMap={vehicleNameMap}
                                isNamesLoaded={isNamesLoaded}
                                ctMap={ctMap}
                                onProjectClick={(p) => setSelectedProject(p as Project)}
                                isWarning
                            />
                        )}
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

// ── フィルターチップ ──────────────────────────────────────────
function FilterChip({
    label,
    active,
    onClick,
    warning,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
    warning?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all min-h-[28px] ${
                active
                    ? warning
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'bg-slate-800 text-white shadow-sm'
                    : warning
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-slate-50 text-slate-600 border border-slate-200'
            }`}
        >
            {label}
        </button>
    );
}

// ── 担当者セクション ──────────────────────────────────────────
interface ManagerSectionProps {
    managerName: string;
    items: ProjectListItem[];
    allForemen: { id: string; displayName: string }[];
    workerNameMap: Map<string, string>;
    vehicleNameMap: Map<string, string>;
    isNamesLoaded: boolean;
    ctMap: Map<string, { name: string; color: string }>;
    onProjectClick: (p: ProjectListItem) => void;
    isWarning?: boolean;
}

function ManagerSection({
    managerName,
    items,
    allForemen,
    workerNameMap,
    vehicleNameMap,
    isNamesLoaded,
    ctMap,
    onProjectClick,
    isWarning,
}: ManagerSectionProps) {
    return (
        <div className={`bg-white rounded-xl border overflow-hidden ${isWarning ? 'border-amber-300' : 'border-slate-200'}`}>
            {/* 担当者ヘッダー(スティッキー) */}
            <div className={`sticky top-0 z-10 px-3 py-2 border-b flex items-center gap-2 ${
                isWarning
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-slate-100 border-slate-200'
            }`}>
                {isWarning && <AlertTriangle className="w-4 h-4 text-amber-600" />}
                <span className={`text-sm font-bold ${isWarning ? 'text-amber-900' : 'text-slate-800'}`}>
                    {managerName}
                </span>
                <span className={`text-[11px] font-medium ${isWarning ? 'text-amber-600' : 'text-slate-400'}`}>
                    {items.length}件
                </span>
            </div>

            {/* デスクトップ: テーブル / モバイル: コンパクト行 */}
            <div className="divide-y divide-slate-100">
                {items.map((p, idx) => {
                    // 1つ前と職長が同じなら〃表示
                    const prevForeman = idx > 0 ? items[idx - 1].assignedEmployeeId : null;
                    const sameForemanAsAbove = idx > 0 && prevForeman && prevForeman === p.assignedEmployeeId;
                    // 1つ前と職長が違う場合は上に余白を入れる
                    const needsTopGap = idx > 0 && prevForeman !== p.assignedEmployeeId;

                    return (
                        <AssignmentRow
                            key={p.id}
                            project={p}
                            allForemen={allForemen}
                            workerNameMap={workerNameMap}
                            vehicleNameMap={vehicleNameMap}
                            isNamesLoaded={isNamesLoaded}
                            ctMap={ctMap}
                            onClick={() => onProjectClick(p)}
                            sameForemanAsAbove={!!sameForemanAsAbove}
                            needsTopGap={!!needsTopGap}
                        />
                    );
                })}
            </div>
        </div>
    );
}

// ── 案件1行 ──────────────────────────────────────────────────
interface AssignmentRowProps {
    project: ProjectListItem;
    allForemen: { id: string; displayName: string }[];
    workerNameMap: Map<string, string>;
    vehicleNameMap: Map<string, string>;
    isNamesLoaded: boolean;
    ctMap: Map<string, { name: string; color: string }>;
    onClick: () => void;
    sameForemanAsAbove: boolean;
    needsTopGap: boolean;
}

function AssignmentRow({
    project: p,
    allForemen,
    workerNameMap,
    vehicleNameMap,
    isNamesLoaded,
    ctMap,
    onClick,
    sameForemanAsAbove,
    needsTopGap,
}: AssignmentRowProps) {
    const foremanName = allForemen.find(f => f.id === p.assignedEmployeeId)?.displayName || '';
    const ctInfo = p.constructionType ? ctMap.get(p.constructionType) : null;
    const color = ctInfo?.color || p.color || '#64748b';

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

    return (
        <button
            onClick={onClick}
            className={`w-full text-left hover:bg-slate-50 active:bg-slate-100 transition-colors ${
                needsTopGap ? 'border-t-4 border-t-slate-100' : ''
            }`}
        >
            <div className="px-3 py-2.5">
                {/* 上段: 順番 + 元請名 + 確定マーク */}
                <div className="flex items-start gap-2">
                    <span
                        className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold text-white"
                        style={{ backgroundColor: color }}
                    >
                        {p.sortOrder ?? '-'}
                    </span>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {/* 元請名 */}
                            {p.customer && (
                                <span
                                    className="text-[13px] font-bold leading-tight"
                                    style={{ color }}
                                >
                                    {p.customer}
                                </span>
                            )}
                            {/* 確定マーク */}
                            {p.isDispatchConfirmed && (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                            )}
                        </div>
                        {/* 現場名(色付き) */}
                        <div
                            className="text-[14px] font-bold leading-snug break-words"
                            style={{ color }}
                        >
                            {p.title}
                        </div>
                    </div>
                </div>

                {/* 下段: 職長 / 人数 / 車両 / メンバー */}
                <div className="mt-1.5 pl-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                    {/* 職長(同じなら〃) */}
                    <span className="inline-flex items-center gap-1 text-slate-700">
                        <span className="text-slate-400 text-[10px]">職長</span>
                        {sameForemanAsAbove ? (
                            <span className="text-slate-400 font-medium">〃</span>
                        ) : foremanName ? (
                            <span className="font-medium">{foremanName}</span>
                        ) : (
                            <span className="text-slate-300">未設定</span>
                        )}
                    </span>

                    {/* 人数 */}
                    {(p.memberCount ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-slate-600">
                            <Users className="w-3 h-3 text-slate-400" />
                            <span className="font-medium">{p.memberCount}名</span>
                        </span>
                    )}

                    {/* 車両 */}
                    {vehicleNames.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-slate-600">
                            <Truck className="w-3 h-3 text-slate-400" />
                            <span className="font-medium truncate max-w-[180px]">
                                {vehicleNames.join('・')}
                            </span>
                        </span>
                    )}
                </div>

                {/* メンバー一覧(あれば別行) */}
                {memberNames.length > 0 && (
                    <div className="mt-1 pl-8 text-[11px] text-slate-500 break-words">
                        <span className="text-slate-400">メンバー: </span>
                        {memberNames.join('・')}
                    </div>
                )}
            </div>
        </button>
    );
}
