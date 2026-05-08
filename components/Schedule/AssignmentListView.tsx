'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Users, Truck, AlertCircle } from 'lucide-react';
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
 * 一覧表示モード - カレンダーの並び順(職長→順番)でフラット表示
 * 旧紙手配表の「作業日報」風レイアウト。モバイル優先。
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

    // 工事種別マップ(色とラベル)
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
        // カレンダー順: 職長順 → 各職長内のsortOrder順
        // 職長未割当は最後に
        return [...dayProjects].sort((a, b) => {
            const aFOrder = a.assignedEmployeeId ? (foremanOrderMap.get(a.assignedEmployeeId) ?? 9999) : 99999;
            const bFOrder = b.assignedEmployeeId ? (foremanOrderMap.get(b.assignedEmployeeId) ?? 9999) : 99999;
            if (aFOrder !== bFOrder) return aFOrder - bFOrder;
            return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        });
    }, [projects, dateKey, foremanOrderMap]);

    // 担当者表示名(短縮: 姓のみ取得を試みる)
    const getShortManagerName = (id: string): string => {
        const full = managerMap.get(id) || '';
        if (!full) return '';
        // 全角/半角スペースで区切られる場合は最初の単語を採用
        const parts = full.split(/[\s　]+/);
        return parts[0] || full;
    };

    return (
        <div className="flex flex-col h-full gap-3">
            {/* テーブル本体 */}
            <div className="flex-1 overflow-auto">
                {sortedProjects.length === 0 ? (
                    <div className="bg-white rounded-xl border border-slate-200 py-10 text-center text-slate-400 text-sm">
                        該当する案件はありません
                    </div>
                ) : (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        {/* テーブルヘッダー(スティッキー) */}
                        <div className="sticky top-0 z-10 grid grid-cols-[44px_28px_1fr] sm:grid-cols-[60px_36px_1fr] gap-1 px-2 py-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                            <div>担当</div>
                            <div className="text-center">順</div>
                            <div>案件</div>
                        </div>

                        <div>
                            {sortedProjects.map((p, idx) => {
                                const prev = idx > 0 ? sortedProjects[idx - 1] : null;
                                const sameForemanAsAbove = !!(prev && prev.assignedEmployeeId && prev.assignedEmployeeId === p.assignedEmployeeId);
                                // 職長が変わったときに余白(separator)を入れる
                                const needsTopGap = !!(prev && prev.assignedEmployeeId !== p.assignedEmployeeId);
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
                                        needsTopGap={needsTopGap}
                                    />
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

// ── 案件1行 ──────────────────────────────────────────────────
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
    needsTopGap: boolean;
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
    needsTopGap,
}: AssignmentRowProps) {
    const foremanName = allForemen.find(f => f.id === p.assignedEmployeeId)?.displayName || '';
    const ctInfo = p.constructionType ? ctMap.get(p.constructionType) : null;
    const color = ctInfo?.color || p.color || '#475569';

    // 案件担当者(複数の場合は連結、1名なら姓のみ)
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

    return (
        <button
            onClick={onClick}
            className={`w-full text-left hover:bg-slate-50 active:bg-slate-100 transition-colors border-b border-slate-100 last:border-b-0 ${
                needsTopGap ? 'border-t-[3px] border-t-slate-200' : ''
            } ${isUnassigned ? 'bg-rose-50/40' : ''}`}
        >
            <div className="grid grid-cols-[44px_28px_1fr] sm:grid-cols-[60px_36px_1fr] gap-1 px-2 py-2">
                {/* 担当 */}
                <div className="flex items-center justify-center">
                    {isUnassigned ? (
                        <span className="inline-flex items-center justify-center gap-0.5 text-[10px] font-bold text-rose-700 bg-rose-100 border border-rose-300 rounded-md px-1 py-0.5 leading-tight">
                            <AlertCircle className="w-2.5 h-2.5" />
                            未
                        </span>
                    ) : (
                        <span className="text-[12px] sm:text-[13px] font-bold text-slate-700 leading-tight truncate">
                            {managerLabel}
                        </span>
                    )}
                </div>

                {/* 順番(色付き) */}
                <div className="flex items-start justify-center pt-[1px]">
                    <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold text-white"
                        style={{ backgroundColor: color }}
                    >
                        {p.sortOrder ?? '-'}
                    </span>
                </div>

                {/* 案件本体 */}
                <div className="min-w-0">
                    {/* 1段目: 元請名 + 確定マーク */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {p.customer && (
                            <span
                                className="text-[12px] sm:text-[13px] font-bold leading-tight"
                                style={{ color }}
                            >
                                {p.customer}
                            </span>
                        )}
                        {p.isDispatchConfirmed && (
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        )}
                    </div>

                    {/* 2段目: 現場名(色付き、太字) */}
                    <div
                        className="text-[14px] sm:text-[15px] font-bold leading-snug break-words mt-0.5"
                        style={{ color }}
                    >
                        {p.title}
                    </div>

                    {/* 3段目: 職長 / 人数 / 車両 */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] sm:text-[12px]">
                        {/* 職長(同じなら〃) */}
                        <span className="inline-flex items-center gap-1 text-slate-700">
                            <span className="text-slate-400 text-[10px]">職長</span>
                            {sameForemanAsAbove ? (
                                <span className="text-slate-400 font-bold tracking-wider">〃</span>
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
                                <span className="font-medium truncate max-w-[160px]">
                                    {vehicleNames.join('・')}
                                </span>
                            </span>
                        )}
                    </div>

                    {/* 4段目: メンバー(あれば) */}
                    {memberNames.length > 0 && (
                        <div className="mt-0.5 text-[11px] text-slate-500 break-words">
                            <span className="text-slate-400">メンバー: </span>
                            {memberNames.join('・')}
                        </div>
                    )}
                </div>
            </div>
        </button>
    );
}
