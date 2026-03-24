'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { X, Check, Users, Truck } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { Project } from '@/types/calendar';
import toast from 'react-hot-toast';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import { formatDateKey } from '@/utils/employeeUtils';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { useCalendarStore } from '@/stores/calendarStore';


interface DispatchUser {
    id: string;
    displayName: string;
    role: string;
}

interface DispatchConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: Project;
}

export default function DispatchConfirmModal({
    isOpen,
    onClose,
    project,
}: DispatchConfirmModalProps) {
    const { vehicles } = useMasterData();
    const { projects, updateProject } = useProjects();
    const allForemen = useCalendarStore((state) => state.allForemen);

    // ユーザーデータの状態
    const [workers, setWorkers] = useState<DispatchUser[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);

    // 初期値設定
    const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>(
        project.confirmedWorkerIds || []
    );
    const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>(
        project.confirmedVehicleIds || []
    );
    const [isSubmitting, setIsSubmitting] = useState(false);

    // モーダルが開くたびに選択状態をリセット（登録時のトラックを事前選択）
    useEffect(() => {
        if (!isOpen) return;
        setSelectedWorkerIds(project.confirmedWorkerIds || []);
        if (project.confirmedVehicleIds?.length) {
            setSelectedVehicleIds(project.confirmedVehicleIds);
        } else {
            const truckNames = (project.trucks || project.vehicles || []) as string[];
            setSelectedVehicleIds(
                truckNames.length > 0 && vehicles.length > 0
                    ? vehicles.filter(v => truckNames.includes(v.name)).map(v => v.id)
                    : []
            );
        }
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
    const modalRef = useModalKeyboard(isOpen, onClose);

    // ユーザーデータの取得
    useEffect(() => {
        if (!isOpen) return;

        const fetchUsers = async () => {
            setIsLoadingUsers(true);
            try {
                const workersRes = await fetch('/api/dispatch/workers');
                if (workersRes.ok) {
                    const data = await workersRes.json();
                    setWorkers(data);
                }
            } catch (error) {
                console.error('Failed to fetch dispatch users:', error);
            } finally {
                setIsLoadingUsers(false);
            }
        };

        fetchUsers();
    }, [isOpen]);

    // 同日の他案件で使用中のワーカーと車両を取得（どの班で使われているか）
    const { workerTeamMap, vehicleTeamMap } = useMemo(() => {
        const dateKey = formatDateKey(project.startDate);
        const sameDayProjects = projects.filter(p =>
            p.id !== project.id &&
            formatDateKey(p.startDate) === dateKey &&
            p.isDispatchConfirmed
        );

        const workerMap = new Map<string, string[]>();
        const vehicleMap = new Map<string, string[]>();

        sameDayProjects.forEach(p => {
            const foreman = allForemen.find(f => f.id === p.assignedEmployeeId);
            const teamName = foreman ? `${foreman.displayName}班` : '他班';

            p.confirmedWorkerIds?.forEach(id => {
                const teams = workerMap.get(id) || [];
                if (!teams.includes(teamName)) teams.push(teamName);
                workerMap.set(id, teams);
            });
            p.confirmedVehicleIds?.forEach(id => {
                const teams = vehicleMap.get(id) || [];
                if (!teams.includes(teamName)) teams.push(teamName);
                vehicleMap.set(id, teams);
            });
        });

        return {
            workerTeamMap: workerMap,
            vehicleTeamMap: vehicleMap,
        };
    }, [projects, project.id, project.startDate, allForemen]);

    const handleWorkerToggle = (workerId: string) => {
        setSelectedWorkerIds(prev =>
            prev.includes(workerId)
                ? prev.filter(id => id !== workerId)
                : [...prev, workerId]
        );
    };

    const handleVehicleToggle = (vehicleId: string) => {
        setSelectedVehicleIds(prev =>
            prev.includes(vehicleId)
                ? prev.filter(id => id !== vehicleId)
                : [...prev, vehicleId]
        );
    };

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await updateProject(project.id, {
                confirmedWorkerIds: selectedWorkerIds,
                confirmedVehicleIds: selectedVehicleIds,
                isDispatchConfirmed: true,
            });

            // 同日・同職長の未確定案件にも同じ作業員・車両をコピー
            const dateKey = formatDateKey(project.startDate);
            const unconfirmedSameDay = projects.filter(p =>
                p.id !== project.id &&
                formatDateKey(p.startDate) === dateKey &&
                p.assignedEmployeeId === project.assignedEmployeeId &&
                !p.isDispatchConfirmed
            );

            for (const p of unconfirmedSameDay) {
                try {
                    await updateProject(p.id, {
                        confirmedWorkerIds: selectedWorkerIds,
                        confirmedVehicleIds: selectedVehicleIds,
                        isDispatchConfirmed: true,
                    });
                } catch {
                    // 個別の失敗は無視（メインの確定は成功済み）
                }
            }

            if (unconfirmedSameDay.length > 0) {
                toast.success(`他${unconfirmedSameDay.length}件の案件も手配確定しました`);
            }

            onClose();
        } catch (error) {
            console.error('Failed to confirm dispatch:', error);
            toast.error('手配確定に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancelDispatch = async () => {
        if (!confirm('手配確定を解除しますか？')) return;

        setIsSubmitting(true);
        try {
            await updateProject(project.id, {
                confirmedWorkerIds: undefined,
                confirmedVehicleIds: undefined,
                isDispatchConfirmed: false,
            });
            onClose();
        } catch (error) {
            console.error('Failed to cancel dispatch:', error);
            toast.error('手配解除に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex flex-col lg:items-center lg:justify-center lg:bg-black/50">
            <div className="absolute inset-0 bg-black/50 hidden lg:block" onClick={onClose} />
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:rounded-lg lg:shadow-lg lg:max-w-2xl lg:h-auto lg:max-h-[90vh] lg:overflow-hidden">
                {/* ヘッダー */}
                <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-800 pwa-modal-safe">
                    <div>
                        <h2 className="text-lg font-semibold text-white">手配確定</h2>
                        <p className="text-sm text-slate-400">{project.title}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-white/70 hover:text-white rounded-lg hover:bg-white/10 transition-colors duration-150"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-6">
                    {isLoadingUsers ? (
                        <div className="flex items-center justify-center py-8">
                            <Loading text="ユーザーデータを読み込み中..." />
                        </div>
                    ) : (
                        <>
                            {/* 職方選択 */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                                    <Users className="w-4 h-4" />
                                    職方（メンバー）
                                </label>
                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3">
                                    {workers.length === 0 ? (
                                        <p className="col-span-2 text-center text-slate-500 py-4">
                                            ユーザー管理でworkerロールのユーザーを追加してください
                                        </p>
                                    ) : (
                                        workers.map(worker => {
                                            const teams = workerTeamMap.get(worker.id);
                                            const isSelected = selectedWorkerIds.includes(worker.id);

                                            return (
                                                <label
                                                    key={worker.id}
                                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${isSelected
                                                        ? 'bg-slate-50 border border-slate-300'
                                                        : 'hover:bg-slate-50'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleWorkerToggle(worker.id)}
                                                        className="w-4 h-4 text-slate-600 rounded focus:ring-slate-500"
                                                    />
                                                    <span className="text-sm">
                                                        {worker.displayName}
                                                        {teams && <span className="text-xs ml-1 text-slate-400">({teams.join('、')})</span>}
                                                    </span>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                                {selectedWorkerIds.length > 0 && (
                                    <p className="text-xs text-slate-500 mt-1">
                                        選択中: {selectedWorkerIds.length}名
                                    </p>
                                )}
                            </div>

                            {/* 車両選択 */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                                    <Truck className="w-4 h-4" />
                                    車両
                                </label>
                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-3">
                                    {vehicles.length === 0 ? (
                                        <p className="col-span-2 text-center text-slate-500 py-4">
                                            設定の車両マスターから車両を追加してください
                                        </p>
                                    ) : (
                                        vehicles.map(vehicle => {
                                            const teams = vehicleTeamMap.get(vehicle.id);
                                            const isSelected = selectedVehicleIds.includes(vehicle.id);

                                            return (
                                                <label
                                                    key={vehicle.id}
                                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${isSelected
                                                        ? 'bg-slate-50 border border-slate-300'
                                                        : 'hover:bg-slate-50'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleVehicleToggle(vehicle.id)}
                                                        className="w-4 h-4 text-slate-600 rounded focus:ring-slate-500"
                                                    />
                                                    <span className="text-sm">
                                                        {vehicle.name}
                                                        {teams && <span className="text-xs ml-1 text-slate-400">({teams.join('、')})</span>}
                                                    </span>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                                {selectedVehicleIds.length > 0 && (
                                    <p className="text-xs text-slate-500 mt-1">
                                        選択中: {selectedVehicleIds.length}台
                                    </p>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* フッター */}
                <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 safe-area-bottom">
                    <div>
                        {project.isDispatchConfirmed && (
                            <button
                                onClick={handleCancelDispatch}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
                            >
                                確定解除
                            </button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                            キャンセル
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isSubmitting || isLoadingUsers}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
                        >
                            <Check className="w-4 h-4" />
                            確定
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

