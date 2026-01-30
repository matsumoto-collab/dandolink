'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { X, Check, Users, Truck } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { Project } from '@/types/calendar';
import toast from 'react-hot-toast';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import { formatDateKey } from '@/utils/employeeUtils';


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

    // 同日の他案件で使用中のワーカーと車両を取得
    const { usedWorkerIds, usedVehicleIds } = useMemo(() => {
        const dateKey = formatDateKey(project.startDate);
        const sameDayProjects = projects.filter(p =>
            p.id !== project.id &&
            formatDateKey(p.startDate) === dateKey &&
            p.isDispatchConfirmed
        );

        const usedWorkers = new Set<string>();
        const usedVehicles = new Set<string>();

        sameDayProjects.forEach(p => {
            p.confirmedWorkerIds?.forEach(id => usedWorkers.add(id));
            p.confirmedVehicleIds?.forEach(id => usedVehicles.add(id));
        });

        return {
            usedWorkerIds: usedWorkers,
            usedVehicleIds: usedVehicles,
        };
    }, [projects, project.id, project.startDate]);

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-slate-700 to-slate-600">
                    <div>
                        <h2 className="text-lg font-bold text-white">手配確定</h2>
                        <p className="text-sm text-slate-300">{project.title}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-white/80 hover:text-white rounded-full hover:bg-white/10"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
                    {isLoadingUsers ? (
                        <div className="flex items-center justify-center py-8">
                            <Loading text="ユーザーデータを読み込み中..." />
                        </div>
                    ) : (
                        <>
                            {/* 職方選択 */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                                    <Users className="w-4 h-4" />
                                    職方（メンバー）
                                </label>
                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
                                    {workers.length === 0 ? (
                                        <p className="col-span-2 text-center text-gray-500 py-4">
                                            ユーザー管理でworkerロールのユーザーを追加してください
                                        </p>
                                    ) : (
                                        workers.map(worker => {
                                            const isUsed = usedWorkerIds.has(worker.id);
                                            const isSelected = selectedWorkerIds.includes(worker.id);

                                            return (
                                                <label
                                                    key={worker.id}
                                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${isUsed
                                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                        : isSelected
                                                            ? 'bg-blue-50 border border-blue-300'
                                                            : 'hover:bg-gray-50'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        disabled={isUsed}
                                                        onChange={() => !isUsed && handleWorkerToggle(worker.id)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 disabled:opacity-50"
                                                    />
                                                    <span className="text-sm">
                                                        {worker.displayName}
                                                        {isUsed && <span className="text-xs ml-1">(使用中)</span>}
                                                    </span>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                                {selectedWorkerIds.length > 0 && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        選択中: {selectedWorkerIds.length}名
                                    </p>
                                )}
                            </div>

                            {/* 車両選択 */}
                            <div>
                                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                                    <Truck className="w-4 h-4" />
                                    車両
                                </label>
                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
                                    {vehicles.length === 0 ? (
                                        <p className="col-span-2 text-center text-gray-500 py-4">
                                            設定の車両マスターから車両を追加してください
                                        </p>
                                    ) : (
                                        vehicles.map(vehicle => {
                                            const isUsed = usedVehicleIds.has(vehicle.id);
                                            const isSelected = selectedVehicleIds.includes(vehicle.id);

                                            return (
                                                <label
                                                    key={vehicle.id}
                                                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${isUsed
                                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                        : isSelected
                                                            ? 'bg-green-50 border border-green-300'
                                                            : 'hover:bg-gray-50'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        disabled={isUsed}
                                                        onChange={() => !isUsed && handleVehicleToggle(vehicle.id)}
                                                        className="w-4 h-4 text-green-600 rounded focus:ring-green-500 disabled:opacity-50"
                                                    />
                                                    <span className="text-sm">
                                                        {vehicle.name}
                                                        {isUsed && <span className="text-xs ml-1">(使用中)</span>}
                                                    </span>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                                {selectedVehicleIds.length > 0 && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        選択中: {selectedVehicleIds.length}台
                                    </p>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* フッター */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
                    <div>
                        {project.isDispatchConfirmed && (
                            <button
                                onClick={handleCancelDispatch}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            >
                                確定解除
                            </button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
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
