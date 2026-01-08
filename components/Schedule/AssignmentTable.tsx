'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useProjects } from '@/contexts/ProjectContext';
import { useCalendarDisplay } from '@/contexts/CalendarDisplayContext';

import { formatDateKey } from '@/utils/employeeUtils';
import { ChevronLeft, ChevronRight, Clock, MapPin, Users, Truck, CheckCircle } from 'lucide-react';

interface AssignmentTableProps {
    userRole?: string;  // admin, manager, foreman1, foreman2, worker
    userTeamId?: string;  // 職方の場合、所属職長ID
}

export default function AssignmentTable({ userRole = 'manager', userTeamId }: AssignmentTableProps) {
    const { projects } = useProjects();
    const { displayedForemanIds, allForemen } = useCalendarDisplay();

    // ワーカー・車両名のマップ
    const [workerNameMap, setWorkerNameMap] = useState<Map<string, string>>(new Map());
    const [vehicleNameMap, setVehicleNameMap] = useState<Map<string, string>>(new Map());
    const [isNamesLoaded, setIsNamesLoaded] = useState(false);

    // ワーカー・車両名の取得
    useEffect(() => {
        const fetchNames = async () => {
            try {
                // ワーカー名取得
                const workersRes = await fetch('/api/dispatch/workers');
                if (workersRes.ok) {
                    const workersData = await workersRes.json();
                    const map = new Map<string, string>();
                    workersData.forEach((w: { id: string; displayName: string }) => {
                        map.set(w.id, w.displayName);
                    });
                    setWorkerNameMap(map);
                }

                // 車両名取得
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
            } catch (error) {
                console.error('Failed to fetch names:', error);
                setIsNamesLoaded(true);
            }
        };

        fetchNames();
    }, []);

    // デフォルトは明日
    const [selectedDate, setSelectedDate] = useState(() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow;
    });

    // 表示する職長リスト（displayedForemanIdsの順番を維持）
    const foremen = useMemo(() => {
        return displayedForemanIds
            .map(id => allForemen.find(user => user.id === id))
            .filter((user): user is typeof allForemen[0] => user !== undefined)
            .map(user => ({ id: user.id, name: user.displayName }));
    }, [displayedForemanIds, allForemen]);

    // 日付をフォーマット
    const formatDisplayDate = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
        const weekDay = weekDays[date.getDay()];
        return `${year}年${month}月${day}日 (${weekDay})`;
    };

    // 日付を変更
    const changeDate = (days: number) => {
        setSelectedDate(prev => {
            const newDate = new Date(prev);
            newDate.setDate(newDate.getDate() + days);
            return newDate;
        });
    };

    // 選択した日付の案件を職長ごとにグループ化
    const assignmentsByEmployee = useMemo(() => {
        const dateStr = formatDateKey(selectedDate);

        // 該当日の案件をフィルタ
        let dayProjects = projects.filter(project => {
            const projectDateStr = formatDateKey(new Date(project.startDate));
            return projectDateStr === dateStr;
        });

        // workerロールの場合、自分がアサインされた案件のみに絞り込み
        if (userRole === 'worker' && userTeamId) {
            dayProjects = dayProjects.filter(project =>
                project.confirmedWorkerIds?.includes(userTeamId)
            );
        }

        // 職長ごとにグループ化
        const grouped: Record<string, typeof dayProjects> = {};

        foremen.forEach(foreman => {
            grouped[foreman.id] = dayProjects.filter(p => p.assignedEmployeeId === foreman.id);
        });

        return grouped;
    }, [projects, foremen, selectedDate, userRole, userTeamId]);

    // 編集権限のチェック
    const canEdit = (employeeId: string) => {
        if (userRole === 'admin' || userRole === 'manager' || userRole === 'foreman1') {
            return true;
        }
        if (userRole === 'foreman2' && employeeId === userTeamId) {
            return true;
        }
        return false;
    };

    return (
        <div className="flex flex-col h-full">
            {/* ヘッダー：日付選択 */}
            <div className="flex items-center justify-center gap-4 mb-6 bg-white rounded-lg shadow-sm p-4">
                <button
                    onClick={() => changeDate(-1)}
                    className="p-2 rounded-full hover:bg-slate-100 transition-colors"
                >
                    <ChevronLeft className="w-6 h-6 text-slate-600" />
                </button>

                <h2 className="text-2xl font-bold text-slate-800 min-w-[200px] text-center">
                    {formatDisplayDate(selectedDate)}
                </h2>

                <button
                    onClick={() => changeDate(1)}
                    className="p-2 rounded-full hover:bg-slate-100 transition-colors"
                >
                    <ChevronRight className="w-6 h-6 text-slate-600" />
                </button>

                <button
                    onClick={() => {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        tomorrow.setHours(0, 0, 0, 0);
                        setSelectedDate(tomorrow);
                    }}
                    className="ml-4 px-4 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                    明日に戻る
                </button>
            </div>

            {/* 手配表本体 */}
            <div className="flex-1 overflow-auto">
                <div className="grid gap-4">
                    {/* workerロールの場合はシンプルなリストで表示 */}
                    {userRole === 'worker' ? (
                        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                            <div className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-6 py-4">
                                <h3 className="text-lg font-bold">あなたの担当現場</h3>
                                <p className="text-sm text-slate-300">
                                    {Object.values(assignmentsByEmployee).flat().length}件の現場
                                </p>
                            </div>
                            <div className="divide-y divide-slate-100">
                                {Object.values(assignmentsByEmployee).flat().length === 0 ? (
                                    <div className="p-6 text-center text-slate-400">
                                        担当現場なし
                                    </div>
                                ) : (
                                    Object.values(assignmentsByEmployee).flat().map(project => {
                                        // 職長名を取得
                                        const foremanName = allForemen.find(user => user.id === project.assignedEmployeeId)?.displayName || '未設定';

                                        return (
                                            <div key={project.id} className="p-4 hover:bg-slate-50 transition-colors">
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        {/* 班名 */}
                                                        <span className="inline-block px-2 py-0.5 bg-slate-600 text-white text-xs font-medium rounded mb-2">
                                                            {foremanName}班
                                                        </span>
                                                        <h4 className="font-bold text-slate-800 text-lg">
                                                            {project.title}
                                                        </h4>
                                                        {project.customer && (
                                                            <p className="text-sm text-slate-600 mt-1">
                                                                {project.customer}
                                                            </p>
                                                        )}
                                                        <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-500">
                                                            <div className="flex items-center gap-1">
                                                                <Clock className="w-4 h-4" />
                                                                <span>未設定</span>
                                                            </div>
                                                            {project.location && (
                                                                <div className="flex items-center gap-1">
                                                                    <MapPin className="w-4 h-4" />
                                                                    <span className="truncate max-w-[200px]">{project.location}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    ) : (
                        /* 管理者・職長用の職長ごとグループ表示 */
                        foremen.map(foreman => {
                            const assignments = assignmentsByEmployee[foreman.id] || [];

                            return (
                                <div key={foreman.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                                    {/* 職長ヘッダー */}
                                    <div className="bg-gradient-to-r from-slate-700 to-slate-600 text-white px-6 py-4">
                                        <h3 className="text-lg font-bold">{foreman.name} 班</h3>
                                        <p className="text-sm text-slate-300">
                                            {assignments.length}件の現場
                                        </p>
                                    </div>

                                    {/* 案件リスト */}
                                    <div className="divide-y divide-slate-100">
                                        {assignments.length === 0 ? (
                                            <div className="p-6 text-center text-slate-400">
                                                予定なし
                                            </div>
                                        ) : (
                                            assignments.map(project => (
                                                <div key={project.id} className="p-4 hover:bg-slate-50 transition-colors">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            {/* 現場名 */}
                                                            <h4 className="font-bold text-slate-800 text-lg">
                                                                {project.title}
                                                            </h4>

                                                            {/* 顧客名 */}
                                                            {project.customer && (
                                                                <p className="text-sm text-slate-600 mt-1">
                                                                    {project.customer}
                                                                </p>
                                                            )}

                                                            {/* 詳細情報 */}
                                                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                                                {/* 集合時間 */}
                                                                <div className="flex items-center gap-2 text-slate-600">
                                                                    <Clock className="w-4 h-4 text-slate-400" />
                                                                    <span>
                                                                        {project.meetingTime || '未設定'}
                                                                    </span>
                                                                </div>

                                                                {/* 場所 */}
                                                                {project.location && (
                                                                    <div className="flex items-center gap-2 text-slate-600">
                                                                        <MapPin className="w-4 h-4 text-slate-400" />
                                                                        <span>{project.location}</span>
                                                                    </div>
                                                                )}

                                                                {/* メンバー */}
                                                                <div className="flex items-center gap-2 text-slate-600">
                                                                    <Users className="w-4 h-4 text-slate-400" />
                                                                    <span>
                                                                        {project.workers?.length || 0}名
                                                                    </span>
                                                                </div>

                                                                {/* 車両 */}
                                                                <div className="flex items-center gap-2 text-slate-600">
                                                                    <Truck className="w-4 h-4 text-slate-400" />
                                                                    <span>
                                                                        {project.trucks?.length || project.vehicles?.length || 0}台
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {/* 確定済み手配情報表示 */}
                                                            {project.isDispatchConfirmed && isNamesLoaded && (
                                                                <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                                                                    <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                                                                        <CheckCircle className="w-4 h-4" />
                                                                        <span>手配確定済み</span>
                                                                    </div>

                                                                    {/* 確定済み職方 */}
                                                                    {project.confirmedWorkerIds && project.confirmedWorkerIds.length > 0 && (
                                                                        <div className="flex items-start gap-2 text-sm text-green-700 mt-1">
                                                                            <Users className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                                                            <span>
                                                                                {project.confirmedWorkerIds
                                                                                    .filter(id => id !== foreman.id && workerNameMap.has(id))
                                                                                    .map(id => workerNameMap.get(id))
                                                                                    .join(', ')}
                                                                            </span>
                                                                        </div>
                                                                    )}

                                                                    {/* 確定済み車両 */}
                                                                    {project.confirmedVehicleIds && project.confirmedVehicleIds.length > 0 && (
                                                                        <div className="flex items-start gap-2 text-sm text-green-700 mt-1">
                                                                            <Truck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                                                            <span>
                                                                                {project.confirmedVehicleIds
                                                                                    .map(id => vehicleNameMap.get(id) || id)
                                                                                    .join(', ')}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* 備考 */}
                                                            {project.remarks && (
                                                                <p className="mt-2 text-sm text-slate-500 bg-slate-50 p-2 rounded">
                                                                    {project.remarks}
                                                                </p>
                                                            )}
                                                        </div>

                                                        {/* 編集ボタン（権限がある場合のみ） */}
                                                        {canEdit(foreman.id) && (
                                                            <div className="ml-4">
                                                                <button className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-slate-600">
                                                                    編集
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            );
                        }))}
                </div>
            </div>
        </div>
    );
}
