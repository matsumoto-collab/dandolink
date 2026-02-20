'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';

import { formatDateKey } from '@/utils/employeeUtils';
import { ChevronLeft, ChevronRight, Clock, MapPin, Users, Truck, CheckCircle, CalendarDays } from 'lucide-react';

interface AssignmentTableProps {
    userRole?: string;
    userTeamId?: string;
}


export default function AssignmentTable({ userRole = 'manager', userTeamId }: AssignmentTableProps) {
    const { projects } = useProjects();
    const { displayedForemanIds, allForemen } = useCalendarDisplay();

    const [workerNameMap, setWorkerNameMap] = useState<Map<string, string>>(new Map());
    const [vehicleNameMap, setVehicleNameMap] = useState<Map<string, string>>(new Map());
    const [isNamesLoaded, setIsNamesLoaded] = useState(false);
    const [namesLoadError, setNamesLoadError] = useState<string | null>(null);

    useEffect(() => {
        const fetchNames = async () => {
            try {
                setNamesLoadError(null);
                const workersRes = await fetch('/api/dispatch/workers');
                if (workersRes.ok) {
                    const workersData = await workersRes.json();
                    const map = new Map<string, string>();
                    workersData.forEach((w: { id: string; displayName: string }) => {
                        map.set(w.id, w.displayName);
                    });
                    setWorkerNameMap(map);
                }
                const vehiclesRes = await fetch('/api/master-data');
                if (vehiclesRes.ok) {
                    const masterData = await vehiclesRes.json();
                    const map = new Map<string, string>();
                    (masterData.vehicles || []).forEach((v: { id: string; name: string }) => {
                        map.set(v.id, v.name);
                    });
                    setVehicleNameMap(map);
                }
                setIsNamesLoaded(true);
            } catch {
                setNamesLoadError('データの取得に失敗しました');
                setIsNamesLoaded(true);
            }
        };
        fetchNames();
    }, []);

    const [selectedDate, setSelectedDate] = useState(() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow;
    });

    const foremen = useMemo(() => {
        return displayedForemanIds
            .map(id => allForemen.find(user => user.id === id))
            .filter((user): user is typeof allForemen[0] => user !== undefined)
            .map(user => ({ id: user.id, name: user.displayName }));
    }, [displayedForemanIds, allForemen]);

    const formatDisplayDate = (date: Date) => {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
        const weekDay = weekDays[date.getDay()];
        const isToday = formatDateKey(date) === formatDateKey(new Date());
        const isTomorrow = (() => {
            const t = new Date(); t.setDate(t.getDate() + 1);
            return formatDateKey(date) === formatDateKey(t);
        })();
        const label = isToday ? '今日' : isTomorrow ? '明日' : null;
        return { month, day, weekDay, label, year: date.getFullYear() };
    };

    const changeDate = (days: number) => {
        setSelectedDate(prev => {
            const newDate = new Date(prev);
            newDate.setDate(newDate.getDate() + days);
            return newDate;
        });
    };

    const goToTomorrow = () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        setSelectedDate(tomorrow);
    };

    const assignmentsByEmployee = useMemo(() => {
        const dateStr = formatDateKey(selectedDate);
        let dayProjects = projects.filter(project => {
            const projectDateStr = formatDateKey(new Date(project.startDate));
            return projectDateStr === dateStr;
        });
        if (userRole === 'worker' && userTeamId) {
            dayProjects = dayProjects.filter(project =>
                project.confirmedWorkerIds?.includes(userTeamId)
            );
            return { '_worker': dayProjects };
        }
        const grouped: Record<string, typeof dayProjects> = {};
        foremen.forEach(foreman => {
            grouped[foreman.id] = dayProjects
                .filter(p => p.assignedEmployeeId === foreman.id)
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        });
        return grouped;
    }, [projects, foremen, selectedDate, userRole, userTeamId]);

    const canEdit = (employeeId: string) => {
        if (userRole === 'admin' || userRole === 'manager' || userRole === 'foreman1') return true;
        if (userRole === 'foreman2' && employeeId === userTeamId) return true;
        return false;
    };

    const dateInfo = formatDisplayDate(selectedDate);

    return (
        <div className="flex flex-col h-full gap-4">
            {namesLoadError && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-sm">
                    {namesLoadError}（名前の表示に影響がある可能性があります）
                </div>
            )}

            {/* 日付ナビゲーション */}
            <div className="flex-shrink-0 bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
                <div className="flex items-center justify-between gap-3">
                    <button
                        onClick={() => changeDate(-1)}
                        className="p-2.5 rounded-xl hover:bg-slate-100 active:bg-slate-200 transition-colors"
                    >
                        <ChevronLeft className="w-5 h-5 text-slate-500" />
                    </button>

                    <div className="flex-1 flex items-center justify-center gap-3">
                        <CalendarDays className="w-5 h-5 text-slate-400 flex-shrink-0" />
                        <div className="text-center">
                            <div className="flex items-baseline gap-1.5 justify-center">
                                <span className="text-2xl font-bold text-slate-800">
                                    {dateInfo.month}/{dateInfo.day}
                                </span>
                                <span className="text-sm font-medium text-slate-500">
                                    ({dateInfo.weekDay})
                                </span>
                                {dateInfo.label && (
                                    <span className="ml-1 px-2 py-0.5 bg-slate-800 text-white text-xs font-bold rounded-full">
                                        {dateInfo.label}
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-slate-400">{dateInfo.year}年</div>
                        </div>
                    </div>

                    <button
                        onClick={() => changeDate(1)}
                        className="p-2.5 rounded-xl hover:bg-slate-100 active:bg-slate-200 transition-colors"
                    >
                        <ChevronRight className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                <div className="mt-3 flex justify-center">
                    <button
                        onClick={goToTomorrow}
                        className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                        明日に戻る
                    </button>
                </div>
            </div>

            {/* 手配表本体 */}
            <div className="flex-1 overflow-auto">
                <div className="space-y-4">
                    {userRole === 'worker' ? (
                        <ForemanSection
                            foremanName="あなたの担当現場"
                            assignments={Object.values(assignmentsByEmployee).flat()}
                            emptyMessage="担当現場なし"
                            canEdit={false}
                            isNamesLoaded={isNamesLoaded}
                            workerNameMap={workerNameMap}
                            vehicleNameMap={vehicleNameMap}
                            foremanId=""
                            showForemanBadge
                            allForemen={allForemen}
                        />
                    ) : (
                        foremen.map((foreman) => {
                            const assignments = assignmentsByEmployee[foreman.id] || [];
                            return (
                                <ForemanSection
                                    key={foreman.id}
                                    foremanName={foreman.name}
                                    assignments={assignments}
                                    emptyMessage="予定なし"
                                    canEdit={canEdit(foreman.id)}
                                    isNamesLoaded={isNamesLoaded}
                                    workerNameMap={workerNameMap}
                                    vehicleNameMap={vehicleNameMap}
                                    foremanId={foreman.id}
                                    allForemen={allForemen}
                                />
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

// ── 職長セクション ──────────────────────────────────────────
interface ForemanSectionProps {
    foremanName: string;
    assignments: ReturnType<typeof useProjects>['projects'];
    emptyMessage: string;
    canEdit: boolean;
    isNamesLoaded: boolean;
    workerNameMap: Map<string, string>;
    vehicleNameMap: Map<string, string>;
    foremanId: string;
    showForemanBadge?: boolean;
    allForemen: { id: string; displayName: string }[];
}

function ForemanSection({
    foremanName,
    assignments,
    emptyMessage,
    canEdit,
    isNamesLoaded,
    workerNameMap,
    vehicleNameMap,
    foremanId,
    showForemanBadge,
    allForemen,
}: ForemanSectionProps) {
    const confirmedCount = assignments.filter(a => a.isDispatchConfirmed).length;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {/* 職長ヘッダー */}
            <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold text-slate-800">{foremanName} 班</span>
                    {assignments.length > 0 && (
                        <span className="text-xs text-slate-400">{assignments.length}件</span>
                    )}
                </div>
                {confirmedCount > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                        <CheckCircle className="w-3.5 h-3.5 text-slate-400" />
                        {confirmedCount}/{assignments.length} 確定
                    </span>
                )}
            </div>

            {/* 案件リスト */}
            <div className="divide-y divide-slate-100">
                {assignments.length === 0 ? (
                    <div className="py-8 text-center text-slate-300 text-sm">{emptyMessage}</div>
                ) : (
                    assignments.map(project => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            canEdit={canEdit}
                            isNamesLoaded={isNamesLoaded}
                            workerNameMap={workerNameMap}
                            vehicleNameMap={vehicleNameMap}
                            foremanId={foremanId}
                            showForemanBadge={showForemanBadge}
                            allForemen={allForemen}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

// ── 案件カード ──────────────────────────────────────────────
interface ProjectCardProps {
    project: ReturnType<typeof useProjects>['projects'][0];
    canEdit: boolean;
    isNamesLoaded: boolean;
    workerNameMap: Map<string, string>;
    vehicleNameMap: Map<string, string>;
    foremanId: string;
    showForemanBadge?: boolean;
    allForemen: { id: string; displayName: string }[];
}

function ProjectCard({
    project,
    canEdit,
    isNamesLoaded,
    workerNameMap,
    vehicleNameMap,
    foremanId,
    showForemanBadge,
    allForemen,
}: ProjectCardProps) {
    const workerCount = project.workers?.length || 0;
    const vehicleCount = project.trucks?.length || project.vehicles?.length || 0;
    const foremanName = showForemanBadge
        ? allForemen.find(u => u.id === project.assignedEmployeeId)?.displayName
        : null;

    const confirmedWorkers = isNamesLoaded && project.confirmedWorkerIds
        ? project.confirmedWorkerIds
            .filter(id => id !== foremanId && workerNameMap.has(id))
            .map(id => workerNameMap.get(id)!)
        : [];

    const confirmedVehicles = isNamesLoaded && project.confirmedVehicleIds
        ? project.confirmedVehicleIds.map(id => vehicleNameMap.get(id) || id)
        : [];

    return (
        <div className="px-5 py-4 hover:bg-slate-50 transition-colors">
            <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                    {/* 手配確定バッジ + 職長バッジ */}
                    {(project.isDispatchConfirmed || foremanName) && (
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {project.isDispatchConfirmed && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                    <CheckCircle className="w-3 h-3" />
                                    手配確定
                                </span>
                            )}
                            {foremanName && (
                                <span className="inline-flex text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                    {foremanName}班
                                </span>
                            )}
                        </div>
                    )}

                    {/* 現場名 */}
                    <h4 className="font-semibold text-slate-900 text-[15px] leading-snug">
                        {project.title}
                    </h4>

                    {/* 顧客名 */}
                    {project.customer && (
                        <p className="text-sm text-slate-400 mt-0.5">{project.customer}</p>
                    )}

                    {/* 集合時間 + 場所 */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                        <span className={`flex items-center gap-1.5 text-sm font-medium ${
                            project.meetingTime ? 'text-slate-700' : 'text-slate-300'
                        }`}>
                            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                            {project.meetingTime || '時間未設定'}
                        </span>
                        {project.location && (
                            <span className="flex items-center gap-1.5 text-sm text-slate-400">
                                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate max-w-[180px]">{project.location}</span>
                            </span>
                        )}
                    </div>

                    {/* メンバー + 車両 */}
                    {(workerCount > 0 || vehicleCount > 0) && (
                        <div className="flex items-center gap-3 mt-2">
                            {workerCount > 0 && (
                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                    <Users className="w-3.5 h-3.5" />
                                    {workerCount}名
                                </span>
                            )}
                            {vehicleCount > 0 && (
                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                    <Truck className="w-3.5 h-3.5" />
                                    {vehicleCount}台
                                </span>
                            )}
                        </div>
                    )}

                    {/* 確定済み詳細（職方・車両名） */}
                    {project.isDispatchConfirmed && isNamesLoaded && (confirmedWorkers.length > 0 || confirmedVehicles.length > 0) && (
                        <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                            {confirmedWorkers.length > 0 && (
                                <div className="flex items-start gap-2 text-sm text-slate-600">
                                    <Users className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-slate-400" />
                                    <span>{confirmedWorkers.join('、')}</span>
                                </div>
                            )}
                            {confirmedVehicles.length > 0 && (
                                <div className="flex items-start gap-2 text-sm text-slate-600">
                                    <Truck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-slate-400" />
                                    <span>{confirmedVehicles.join('、')}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 備考 */}
                    {project.remarks && (
                        <p className="mt-2 text-sm text-slate-400 border-l-2 border-slate-200 pl-3">
                            {project.remarks}
                        </p>
                    )}
                </div>

                {/* 編集ボタン */}
                {canEdit && (
                    <button className="flex-shrink-0 px-4 py-2 text-sm font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 active:bg-slate-100 rounded-xl transition-colors min-h-[44px]">
                        編集
                    </button>
                )}
            </div>
        </div>
    );
}
