'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { X, Check, Users, Truck, ChevronDown, ChevronUp } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { Project } from '@/types/calendar';
import toast from 'react-hot-toast';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import { formatDateKey } from '@/utils/employeeUtils';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { useCalendarStore } from '@/stores/calendarStore';
import { logger } from '@/lib/logger';


interface DispatchUser {
    id: string;
    displayName: string;
    role: string;
}

// 手配確定でよく選ばれるロール（常時表示）
const PRIMARY_ROLES = new Set(['worker', 'foreman1', 'foreman2']);

// ロール優先度（小さいほど上に表示）
const ROLE_PRIORITY: Record<string, number> = {
    worker: 1,
    foreman2: 2,
    foreman1: 3,
    support: 4,
    manager: 5,
    admin: 6,
};

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
    const [showSecondaryWorkers, setShowSecondaryWorkers] = useState(false);

    // モーダルが開くたびに選択状態をリセット（登録時のトラックを事前選択）
    useEffect(() => {
        if (!isOpen) return;
        setShowSecondaryWorkers(false);
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
                logger.error('Failed to fetch dispatch users:', error);
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

    // ロール別に並び替え + よく使う / たまに使う に分割
    const { primaryWorkers, secondaryWorkers } = useMemo(() => {
        const sorted = [...workers].sort((a, b) => {
            const roleA = (a.role || '').toLowerCase();
            const roleB = (b.role || '').toLowerCase();
            const priorityDiff = (ROLE_PRIORITY[roleA] ?? 99) - (ROLE_PRIORITY[roleB] ?? 99);
            if (priorityDiff !== 0) return priorityDiff;
            return a.displayName.localeCompare(b.displayName, 'ja');
        });
        return {
            primaryWorkers: sorted.filter(w => PRIMARY_ROLES.has((w.role || '').toLowerCase())),
            secondaryWorkers: sorted.filter(w => !PRIMARY_ROLES.has((w.role || '').toLowerCase())),
        };
    }, [workers]);

    // 普段使わないロールで既に選択されているメンバーがいれば自動展開
    const hasSelectedSecondary = secondaryWorkers.some(w => selectedWorkerIds.includes(w.id));
    const showSecondaryEffective = showSecondaryWorkers || hasSelectedSecondary;

    // 必要メンバー数（案件登録時の人数）と過不足を示すバッジ色
    const requiredMemberCount = project.memberCount ?? 0;
    const memberCountBadgeClass = useMemo(() => {
        if (selectedWorkerIds.length === 0) return 'bg-slate-100 text-slate-500';
        if (requiredMemberCount === 0) return 'bg-slate-100 text-slate-700';
        if (selectedWorkerIds.length < requiredMemberCount) return 'bg-amber-100 text-amber-700';
        if (selectedWorkerIds.length === requiredMemberCount) return 'bg-emerald-100 text-emerald-700';
        return 'bg-sky-100 text-sky-700';
    }, [selectedWorkerIds.length, requiredMemberCount]);

    const renderWorkerChip = (worker: DispatchUser) => {
        const teams = workerTeamMap.get(worker.id);
        const isSelected = selectedWorkerIds.includes(worker.id);
        return (
            <button
                key={worker.id}
                type="button"
                onClick={() => handleWorkerToggle(worker.id)}
                className={`relative flex items-center justify-center gap-1.5 px-3 min-h-[52px] rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${isSelected
                    ? 'bg-slate-800 text-white border-2 border-slate-800 shadow-sm'
                    : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                    }`}
            >
                {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                <span className="truncate">{worker.displayName}</span>
                {teams && (
                    <span className="absolute -top-2 -right-1 px-1.5 py-0.5 text-[10px] bg-amber-400 text-amber-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                        {teams.join('・')}
                    </span>
                )}
            </button>
        );
    };

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

            // プッシュ通知を送る（失敗しても手配確定自体は成功なので例外は握り潰す）
            const assignmentIds: string[] = [
                project.assignmentId || project.id,
                ...unconfirmedSameDay.map((p) => p.assignmentId || p.id),
            ];
            void Promise.all(
                assignmentIds.map((id) =>
                    fetch('/api/push/notify-dispatch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ assignmentId: id }),
                    }).catch(() => undefined)
                )
            );

            onClose();
        } catch (error) {
            logger.error('Failed to confirm dispatch:', error);
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
            logger.error('Failed to cancel dispatch:', error);
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
                                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                        <Users className="w-4 h-4" />
                                        職方（メンバー）
                                    </label>
                                    <div className="flex items-center gap-2 text-xs">
                                        {requiredMemberCount > 0 && (
                                            <span className="text-slate-500">
                                                必要 <span className="font-semibold text-slate-700 text-sm">{requiredMemberCount}</span> 名
                                            </span>
                                        )}
                                        <span className={`px-2.5 py-1 rounded-full font-semibold ${memberCountBadgeClass}`}>
                                            選択 {selectedWorkerIds.length} 名
                                        </span>
                                    </div>
                                </div>
                                {workers.length === 0 ? (
                                    <p className="text-center text-slate-500 py-6 border border-slate-200 rounded-xl">
                                        ユーザー管理でworkerロールのユーザーを追加してください
                                    </p>
                                ) : (
                                    <>
                                        {primaryWorkers.length > 0 && (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                {primaryWorkers.map(worker => renderWorkerChip(worker))}
                                            </div>
                                        )}

                                        {secondaryWorkers.length > 0 && (
                                            <>
                                                {showSecondaryEffective ? (
                                                    <div className="mt-4">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="text-xs font-semibold text-slate-500">
                                                                管理者・マネージャー等
                                                            </span>
                                                            <div className="flex-1 h-px bg-slate-200" />
                                                            {!hasSelectedSecondary && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setShowSecondaryWorkers(false)}
                                                                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                                                                >
                                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                                    閉じる
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                            {secondaryWorkers.map(worker => renderWorkerChip(worker))}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowSecondaryWorkers(true)}
                                                        className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 text-sm text-slate-600 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-xl transition-colors"
                                                    >
                                                        <ChevronDown className="w-4 h-4" />
                                                        もっと見る（管理者・マネージャー等 {secondaryWorkers.length}名）
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* 車両選択 */}
                            <div>
                                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                        <Truck className="w-4 h-4" />
                                        車両
                                    </label>
                                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${selectedVehicleIds.length === 0
                                        ? 'bg-slate-100 text-slate-500'
                                        : 'bg-slate-100 text-slate-700'
                                        }`}>
                                        選択 {selectedVehicleIds.length} 台
                                    </span>
                                </div>
                                {vehicles.length === 0 ? (
                                    <p className="text-center text-slate-500 py-6 border border-slate-200 rounded-xl">
                                        設定の車両マスターから車両を追加してください
                                    </p>
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {vehicles.map(vehicle => {
                                            const teams = vehicleTeamMap.get(vehicle.id);
                                            const isSelected = selectedVehicleIds.includes(vehicle.id);

                                            return (
                                                <button
                                                    key={vehicle.id}
                                                    type="button"
                                                    onClick={() => handleVehicleToggle(vehicle.id)}
                                                    className={`relative flex items-center justify-center gap-1.5 px-3 min-h-[52px] rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${isSelected
                                                        ? 'bg-slate-800 text-white border-2 border-slate-800 shadow-sm'
                                                        : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                                                        }`}
                                                >
                                                    {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                                                    <span className="truncate">{vehicle.name}</span>
                                                    {teams && (
                                                        <span className="absolute -top-2 -right-1 px-1.5 py-0.5 text-[10px] bg-amber-400 text-amber-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                                                            {teams.join('・')}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* フッター */}
                <div className="flex-shrink-0 flex items-center justify-between px-6 pt-4 pb-6 border-t border-slate-200 bg-slate-50 safe-area-bottom">
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

