'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { X, Check, Users, Truck, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { Project } from '@/types/calendar';
import toast from 'react-hot-toast';
import { useMasterData } from '@/hooks/useMasterData';
import { isSchedulableTool } from '@/lib/equipment';
import { useProjects } from '@/hooks/useProjects';
import { useVacation } from '@/hooks/useVacation';
import { formatDateKey } from '@/utils/employeeUtils';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { useCalendarStore } from '@/stores/calendarStore';
import { logger } from '@/lib/logger';


interface DispatchUser {
    id: string;
    displayName: string;
    role: string;
    dispatchSortOrder?: number | null;
    hideByDefaultInDispatch?: boolean;
    companyId?: string | null;
    company?: { id: string; displayName: string } | null;
}

// 並び順未設定時のロール優先度フォールバック（小さいほど上）
const ROLE_PRIORITY: Record<string, number> = {
    worker: 1,
    partner_member: 1.5,
    partner: 1.7,
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
    const { vehicles, tools: toolMaster } = useMasterData();
    const { projects, updateProject } = useProjects();
    const { getVacationEmployees } = useVacation();
    const allForemen = useCalendarStore((state) => state.allForemen);

    // この日に休暇のメンバー（チップに「休暇」表示。急遽の出勤もあるため選択は禁止しない）
    const vacationIdSet = useMemo(() => {
        const dateKey = formatDateKey(project.startDate);
        return new Set(getVacationEmployees(dateKey));
    }, [getVacationEmployees, project.startDate]);

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
    const [selectedToolIds, setSelectedToolIds] = useState<string[]>(
        project.confirmedToolIds || []
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSecondaryWorkers, setShowSecondaryWorkers] = useState(false);
    // 同じ班・同じ日の他案件にも反映するか（デフォルトON）。OFFならこの案件のみ変更。
    const [applyToTeam, setApplyToTeam] = useState(true);

    // モーダルが開くたびに選択状態をリセット（登録時のトラックを事前選択）
    useEffect(() => {
        if (!isOpen) return;
        setShowSecondaryWorkers(false);
        setApplyToTeam(true);
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
        // 電動工具は登録時から Tool.id なので、そのまま事前選択できる
        setSelectedToolIds(
            project.confirmedToolIds?.length ? project.confirmedToolIds : (project.tools || [])
        );
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
    // - 確定済み案件 → 確定メンバー / 確定車両（vehicleTeamMap・琥珀バッジ）
    // - 未確定案件 → スケジュール登録時の予定車両（vehiclePlannedTeamMap・水色バッジ）
    //   ※予定車両は車両「名」で保存されているため、車両マスターで名前→IDに変換する
    const { workerTeamMap, vehicleTeamMap, vehiclePlannedTeamMap, toolTeamMap, toolPlannedTeamMap } = useMemo(() => {
        const dateKey = formatDateKey(project.startDate);
        const sameDayProjects = projects.filter(p =>
            p.id !== project.id &&
            formatDateKey(p.startDate) === dateKey
        );

        // 予定車両の名前→ID 逆引き
        const vehicleIdByName = new Map<string, string>();
        vehicles.forEach(v => vehicleIdByName.set(v.name, v.id));

        const workerMap = new Map<string, string[]>();
        const vehicleMap = new Map<string, string[]>();        // 他班が確定済み
        const vehiclePlannedMap = new Map<string, string[]>(); // 他班が予定（未確定）
        const toolMap = new Map<string, string[]>();           // 電動工具（他班が確定済み）
        const toolPlannedMap = new Map<string, string[]>();    // 電動工具（他班が予定）

        sameDayProjects.forEach(p => {
            const foreman = allForemen.find(f => f.id === p.assignedEmployeeId);
            const teamName = foreman ? `${foreman.displayName}班` : '他班';

            if (p.isDispatchConfirmed) {
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
                p.confirmedToolIds?.forEach(id => {
                    const teams = toolMap.get(id) || [];
                    if (!teams.includes(teamName)) teams.push(teamName);
                    toolMap.set(id, teams);
                });
            } else {
                // スケジュール登録時に指定された予定車両（まだ手配確定されていない）
                const plannedNames = (p.trucks || p.vehicles || []) as string[];
                plannedNames.forEach(name => {
                    const id = vehicleIdByName.get(name);
                    if (!id) return;
                    const teams = vehiclePlannedMap.get(id) || [];
                    if (!teams.includes(teamName)) teams.push(teamName);
                    vehiclePlannedMap.set(id, teams);
                });
                // 電動工具は最初から ID なので名前の逆引きは要らない
                (p.tools || []).forEach(id => {
                    const teams = toolPlannedMap.get(id) || [];
                    if (!teams.includes(teamName)) teams.push(teamName);
                    toolPlannedMap.set(id, teams);
                });
            }
        });

        // 同じ車両を同じ班が「確定」もしている場合は「予定」表示から省く（重複防止）
        vehiclePlannedMap.forEach((teams, id) => {
            const confirmedTeams = vehicleMap.get(id);
            if (!confirmedTeams) return;
            const remaining = teams.filter(t => !confirmedTeams.includes(t));
            if (remaining.length > 0) vehiclePlannedMap.set(id, remaining);
            else vehiclePlannedMap.delete(id);
        });

        toolPlannedMap.forEach((teams, id) => {
            const confirmedTeams = toolMap.get(id);
            if (!confirmedTeams) return;
            const remaining = teams.filter(t => !confirmedTeams.includes(t));
            if (remaining.length > 0) toolPlannedMap.set(id, remaining);
            else toolPlannedMap.delete(id);
        });

        return {
            workerTeamMap: workerMap,
            vehicleTeamMap: vehicleMap,
            vehiclePlannedTeamMap: vehiclePlannedMap,
            toolTeamMap: toolMap,
            toolPlannedTeamMap: toolPlannedMap,
        };
    }, [projects, project.id, project.startDate, allForemen, vehicles]);

    // 連動対象: 同じ班・同じ日・自分以外。作業完了済み（workEndedAt あり）も含める。
    // ＝協力会社など「作業完了の連絡が入ってから手配確定する」運用でも、同じ班・同じ日の
    //   全案件へ同じメンバーを反映できるようにするため（完了済みを弾くと別々に確定する羽目になる）。
    // 確定/変更の連動先であり、ラジオの表示判定にも使う。
    const eligibleSiblings = useMemo(() => {
        const dateKey = formatDateKey(project.startDate);
        return projects.filter(p =>
            p.id !== project.id &&
            formatDateKey(p.startDate) === dateKey &&
            p.assignedEmployeeId === project.assignedEmployeeId
        );
    }, [projects, project.id, project.startDate, project.assignedEmployeeId]);

    // 並び替え: dispatchSortOrder 昇順 → ロール優先度 → 名前順
    // 分割: hideByDefaultInDispatch が true のユーザーを「もっと見る」へ
    const { primaryWorkers, secondaryWorkers } = useMemo(() => {
        const sorted = [...workers].sort((a, b) => {
            const orderA = a.dispatchSortOrder ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.dispatchSortOrder ?? Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
            const roleA = (a.role || '').toLowerCase();
            const roleB = (b.role || '').toLowerCase();
            const priorityDiff = (ROLE_PRIORITY[roleA] ?? 99) - (ROLE_PRIORITY[roleB] ?? 99);
            if (priorityDiff !== 0) return priorityDiff;
            return a.displayName.localeCompare(b.displayName, 'ja');
        });
        return {
            primaryWorkers: sorted.filter(w => !w.hideByDefaultInDispatch),
            secondaryWorkers: sorted.filter(w => !!w.hideByDefaultInDispatch),
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
        const isOnVacation = vacationIdSet.has(worker.id);
        const parentCompanyName =
            worker.role === 'partner_member' ? (worker.company?.displayName ?? null) : null;

        // 未選択時はカード全体で状態を示す（バッジだけだと見落とすため）:
        // 休暇=淡い赤 ＞ 他案件で手配済み=淡い琥珀 ＞ 空き=白。いずれも選択は可能。
        const chipClass = isSelected
            ? 'bg-slate-800 text-white border-2 border-slate-800 shadow-sm'
            : isOnVacation
                ? 'bg-rose-50 text-slate-400 border-2 border-rose-200 hover:border-rose-300'
                : teams
                    ? 'bg-amber-50 text-slate-500 border-2 border-amber-300 hover:border-amber-400'
                    : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50';

        return (
            <button
                key={worker.id}
                type="button"
                onClick={() => handleWorkerToggle(worker.id)}
                className={`relative flex items-center justify-center gap-1.5 px-3 min-h-[52px] rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${chipClass}`}
            >
                {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                <div className="flex flex-col items-center min-w-0 leading-tight">
                    {parentCompanyName && (
                        <span className={`text-[10px] truncate max-w-full ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                            {parentCompanyName}
                        </span>
                    )}
                    <span className="truncate max-w-full">{worker.displayName}</span>
                </div>
                {isOnVacation && (
                    <span className="absolute -top-2 -left-1 px-1.5 py-0.5 text-[10px] bg-rose-500 text-white rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                        休暇
                    </span>
                )}
                {teams && (
                    <span className="absolute -top-2 -right-1 px-1.5 py-0.5 text-[10px] bg-amber-400 text-amber-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                        {teams.join('・')}
                    </span>
                )}
            </button>
        );
    };

    // 選べる工具（台帳から外した分・廃棄・紛失は隠す）
    const selectableTools = useMemo(
        () => toolMaster.filter(t => isSchedulableTool(t, selectedToolIds)),
        [toolMaster, selectedToolIds]
    );

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

    const handleToolToggle = (toolId: string) => {
        setSelectedToolIds(prev =>
            prev.includes(toolId)
                ? prev.filter(id => id !== toolId)
                : [...prev, toolId]
        );
    };

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await updateProject(project.id, {
                confirmedWorkerIds: selectedWorkerIds,
                confirmedVehicleIds: selectedVehicleIds,
                confirmedToolIds: selectedToolIds,
                isDispatchConfirmed: true,
            });

            // 同じ班・同じ日の他案件にも同じ作業員・車両・確定状態を反映。
            // 確定済み案件も上書きするので「メンバー/車両変更」も連動する。
            // 作業完了済みはスキップ（eligibleSiblings で除外済み）。
            // 「この案件のみ変更する」(applyToTeam=false) を選んだ場合は連動しない。
            const teamSiblings = applyToTeam ? eligibleSiblings : [];

            for (const p of teamSiblings) {
                try {
                    await updateProject(p.id, {
                        confirmedWorkerIds: selectedWorkerIds,
                        confirmedVehicleIds: selectedVehicleIds,
                        confirmedToolIds: selectedToolIds,
                        isDispatchConfirmed: true,
                    });
                } catch {
                    // 個別の失敗は無視（メインの確定は成功済み）
                }
            }

            if (teamSiblings.length > 0) {
                toast.success(`他${teamSiblings.length}件の案件にも反映しました`);
            }

            // プッシュ通知を送る（失敗しても手配確定自体は成功なので例外は握り潰す）
            const assignmentIds: string[] = [
                project.assignmentId || project.id,
                ...teamSiblings.map((p) => p.assignmentId || p.id),
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

            // 車両引き継ぎ通知（サーバ側で前後30日突合→ペア差分→集約送信を行う）。
            // 兄弟手配は1回の POST にまとめてサーバ側で集約（P1-1）。
            void fetch('/api/push/notify-vehicle-handover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignmentIds, mode: 'confirm' }),
            }).catch(() => undefined);

            onClose();
        } catch (error) {
            logger.error('Failed to confirm dispatch:', error);
            toast.error('手配確定に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancelDispatch = async () => {
        // 同じ班・同じ日の手配確定済み兄弟案件（自分以外）を探す。
        // 判定条件は「確定の連動」(handleConfirm) とまったく同じに揃える。
        const dateKey = formatDateKey(project.startDate);
        const confirmedSiblings = projects.filter(p =>
            p.id !== project.id &&
            formatDateKey(p.startDate) === dateKey &&
            p.assignedEmployeeId === project.assignedEmployeeId &&
            p.isDispatchConfirmed
        );
        // 連動解除の対象は「作業完了通知が押されていない」案件のみ。
        // 作業完了済みの兄弟案件はスキップする（押した案件自体は明示操作のため対象に含める）。
        const cancelableSiblings = confirmedSiblings.filter(p => !p.workEndedAt);
        const skippedSiblings = confirmedSiblings.filter(p => !!p.workEndedAt);

        // 確認メッセージを組み立て（連動先がある場合のみ件数を追記）
        const foreman = allForemen.find(f => f.id === project.assignedEmployeeId);
        const teamName = foreman ? `${foreman.displayName}班` : 'この班';
        let message = '手配確定を解除しますか？';
        if (cancelableSiblings.length > 0) {
            message += `\n\n${teamName}の他の案件（${cancelableSiblings.length}件）も同時に解除されます。`;
        }
        if (skippedSiblings.length > 0) {
            message += `\n\n※ ${skippedSiblings.length}件は作業完了済みのため解除対象外です。`;
        }
        if (!confirm(message)) return;

        setIsSubmitting(true);
        try {
            // 押した案件本体を解除（作業完了済みでも明示操作なので解除する）。
            // 確定メンバー/車両は必ず空配列で送る。undefined だと JSON.stringify でキーが
            // 落ち、API 側（confirmedWorkerIds !== undefined のときだけ更新）が「変更なし」と
            // 解釈して確定値が残ってしまう（＝解除後もモーダルに選択が残る不具合）。
            await updateProject(project.id, {
                confirmedWorkerIds: [],
                confirmedVehicleIds: [],
                confirmedToolIds: [],
                isDispatchConfirmed: false,
            });

            // 同じ班・同じ日の兄弟案件も連動解除（個別失敗は握り潰す＝本体の解除は成功済み）
            for (const p of cancelableSiblings) {
                try {
                    await updateProject(p.id, {
                        confirmedWorkerIds: [],
                        confirmedVehicleIds: [],
                        confirmedToolIds: [],
                        isDispatchConfirmed: false,
                    });
                } catch {
                    // 個別の失敗は無視
                }
            }

            if (cancelableSiblings.length > 0) {
                toast.success(`他${cancelableSiblings.length}件の案件も手配解除しました`);
            }

            // 車両引き継ぎ通知の取り消し（既存の有効通知を再計算 → 消えたペアに取消通知）。
            // 解除済み（confirmedVehicleIds が空）の状態をサーバが検知し、自前で差分する。
            const canceledAssignmentIds: string[] = [
                project.assignmentId || project.id,
                ...cancelableSiblings.map((p) => p.assignmentId || p.id),
            ];
            void fetch('/api/push/notify-vehicle-handover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assignmentIds: canceledAssignmentIds, mode: 'cancel' }),
            }).catch(() => undefined);

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
                                {workerTeamMap.size > 0 && (
                                    <p className="mb-2 text-[11px] text-slate-400">
                                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-300 align-[-1px] mr-1" />
                                        オレンジ＝同日の他案件で手配済み（バッジは手配先の班）
                                    </p>
                                )}
                                {workers.length === 0 ? (
                                    <p className="text-center text-slate-500 py-6 border border-slate-200 rounded-xl">
                                        ユーザー管理または協力会社からメンバーを追加してください
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
                                                                その他メンバー
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
                                                        もっと見る（その他 {secondaryWorkers.length}名）
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
                                            const plannedTeams = vehiclePlannedTeamMap.get(vehicle.id);
                                            const isSelected = selectedVehicleIds.includes(vehicle.id);

                                            // メンバーと同じく未選択時はカード全体で状態を示す:
                                            // 他班確定済み=淡い琥珀 ＞ 他班予定のみ=淡い水色 ＞ 空き=白
                                            const vehicleChipClass = isSelected
                                                ? 'bg-slate-800 text-white border-2 border-slate-800 shadow-sm'
                                                : teams
                                                    ? 'bg-amber-50 text-slate-500 border-2 border-amber-300 hover:border-amber-400'
                                                    : plannedTeams
                                                        ? 'bg-sky-50 text-slate-500 border-2 border-sky-300 hover:border-sky-400'
                                                        : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50';

                                            return (
                                                <button
                                                    key={vehicle.id}
                                                    type="button"
                                                    onClick={() => handleVehicleToggle(vehicle.id)}
                                                    className={`relative flex items-center justify-center gap-1.5 px-3 min-h-[52px] rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${vehicleChipClass}`}
                                                >
                                                    {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                                                    <span className="truncate">{vehicle.name}</span>
                                                    {/* 他班が確定済み（琥珀） */}
                                                    {teams && (
                                                        <span className="absolute -top-2 -right-1 px-1.5 py-0.5 text-[10px] bg-amber-400 text-amber-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                                                            {teams.join('・')}
                                                        </span>
                                                    )}
                                                    {/* 他班がスケジュールで予定（水色・未確定） */}
                                                    {plannedTeams && (
                                                        <span className="absolute -top-2 -left-1 px-1.5 py-0.5 text-[10px] bg-sky-400 text-sky-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                                                            {plannedTeams.join('・')}予定
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* 電動工具選択（登録された工具がある会社だけ表示） */}
                            {selectableTools.length > 0 && (
                                <div>
                                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                            <Wrench className="w-4 h-4" />
                                            電動工具
                                        </label>
                                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${selectedToolIds.length === 0
                                            ? 'bg-slate-100 text-slate-500'
                                            : 'bg-slate-100 text-slate-700'
                                            }`}>
                                            選択 {selectedToolIds.length} 点
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {selectableTools.map(tool => {
                                            const teams = toolTeamMap.get(tool.id);
                                            const plannedTeams = toolPlannedTeamMap.get(tool.id);
                                            const isSelected = selectedToolIds.includes(tool.id);

                                            // 車両と同じ配色: 他班確定済み=淡い琥珀 ＞ 他班予定のみ=淡い水色 ＞ 空き=白
                                            const toolChipClass = isSelected
                                                ? 'bg-slate-800 text-white border-2 border-slate-800 shadow-sm'
                                                : teams
                                                    ? 'bg-amber-50 text-slate-500 border-2 border-amber-300 hover:border-amber-400'
                                                    : plannedTeams
                                                        ? 'bg-sky-50 text-slate-500 border-2 border-sky-300 hover:border-sky-400'
                                                        : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50';

                                            return (
                                                <button
                                                    key={tool.id}
                                                    type="button"
                                                    onClick={() => handleToolToggle(tool.id)}
                                                    className={`relative flex items-center justify-center gap-1.5 px-3 min-h-[52px] rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${toolChipClass}`}
                                                >
                                                    {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                                                    <span className="truncate">{tool.name}</span>
                                                    {teams && (
                                                        <span className="absolute -top-2 -right-1 px-1.5 py-0.5 text-[10px] bg-amber-400 text-amber-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                                                            {teams.join('・')}
                                                        </span>
                                                    )}
                                                    {plannedTeams && (
                                                        <span className="absolute -top-2 -left-1 px-1.5 py-0.5 text-[10px] bg-sky-400 text-sky-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                                                            {plannedTeams.join('・')}予定
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* 反映範囲の選択（同じ班・同じ日に他案件があるときだけ表示） */}
                            {eligibleSiblings.length > 0 && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <p className="text-sm font-semibold text-slate-700 mb-2">
                                        同じ班・同じ日の他案件（{eligibleSiblings.length}件）への反映
                                    </p>
                                    <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="applyScope"
                                            checked={applyToTeam}
                                            onChange={() => setApplyToTeam(true)}
                                            className="mt-0.5 w-4 h-4 accent-slate-800"
                                        />
                                        <span className="text-sm text-slate-700">
                                            他の案件にも同じ内容を反映する<span className="text-slate-500">（推奨）</span>
                                        </span>
                                    </label>
                                    <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="applyScope"
                                            checked={!applyToTeam}
                                            onChange={() => setApplyToTeam(false)}
                                            className="mt-0.5 w-4 h-4 accent-slate-800"
                                        />
                                        <span className="text-sm text-slate-700">
                                            この案件のみ変更する
                                        </span>
                                    </label>
                                </div>
                            )}
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
                            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
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

