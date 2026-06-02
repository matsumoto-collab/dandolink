'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Users, X, Plus, FileDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { FormField } from '../common/FormField';
import { ProjectMasterFormData, WorkDateEntry } from '../ProjectMasterForm';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useCalendarStore } from '@/stores/calendarStore';
import { useMasterStore, selectConstructionTypes } from '@/stores/masterStore';
import { ConstructionTypeMaster, ProjectAssignment } from '@/types/calendar';
import { useEstimates } from '@/hooks/useEstimates';
import EstimatePickerDialog from '@/components/Estimates/EstimatePickerDialog';

interface ConstructionSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
    /** 編集時のみ：見積から契約金額(足場工事金額)へ反映するために使用。 */
    projectMasterId?: string;
}

function toJSTDateStr(date: Date | string): string {
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(date)).replace(/\//g, '-');
}

async function fetchAssignmentsForDate(date: string): Promise<ProjectAssignment[]> {
    const base = new Date(`${date}T00:00:00Z`);
    const prevDay = new Date(base);
    prevDay.setUTCDate(prevDay.getUTCDate() - 1);
    const nextDay = new Date(base);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const res = await fetch(
        `/api/assignments?startDate=${prevDay.toISOString().slice(0, 10)}&endDate=${nextDay.toISOString().slice(0, 10)}`,
        { cache: 'no-store' }
    );
    if (!res.ok) return [];
    const all: ProjectAssignment[] = await res.json();
    return all.filter(a => toJSTDateStr(a.date) === date);
}

function DateConflictList({
    assignments,
    getForemanName,
    displayedForemanIds,
    getTotalMembersForDate,
    dateStr,
    vacationCount,
    isLoading,
}: {
    assignments: ProjectAssignment[];
    getForemanName: (id: string) => string;
    displayedForemanIds: string[];
    getTotalMembersForDate: (dateStr: string) => number;
    dateStr: string;
    vacationCount: number;
    isLoading: boolean;
}) {
    if (isLoading) {
        return (
            <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                この日の案件を確認中...
            </div>
        );
    }
    if (assignments.length === 0) return null;

    const byForeman = new Map<string, number[]>();
    assignments.forEach(a => {
        if (!byForeman.has(a.assignedEmployeeId)) byForeman.set(a.assignedEmployeeId, []);
        byForeman.get(a.assignedEmployeeId)!.push(a.memberCount || 0);
    });
    let assignedCount = 0;
    byForeman.forEach(counts => { assignedCount += Math.max(...counts); });
    const totalMembers = getTotalMembersForDate(dateStr);
    const remaining = totalMembers > 0 ? totalMembers - assignedCount - vacationCount : null;

    const sorted = [...assignments].sort((a, b) => {
        const ai = displayedForemanIds.indexOf(a.assignedEmployeeId);
        const bi = displayedForemanIds.indexOf(b.assignedEmployeeId);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    });

    return (
        <div className="mt-2 space-y-1">
            <p className="text-xs font-medium text-amber-600">
                この日に既に入っている案件（{assignments.length}件
                {remaining !== null && ` / 残${remaining}人`}）
            </p>
            {sorted.map(a => (
                <div
                    key={a.id}
                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs"
                >
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    <span className="font-semibold text-slate-800 min-w-[4rem]">
                        {getForemanName(a.assignedEmployeeId)}
                    </span>
                    <span className="text-slate-600 truncate">
                        {a.projectMaster?.name
                            ? `${a.projectMaster.name}${a.projectMaster.honorific || ''}`
                            : a.projectMaster?.title ?? '（現場名なし）'}
                    </span>
                    {a.memberCount > 0 && (
                        <span className="ml-auto text-slate-500 whitespace-nowrap flex-shrink-0">
                            {a.memberCount}名
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}

function ForemanSelector({
    phaseLabel,
    date,
    foremen,
    selected,
    existingAssignments,
    onChange,
}: {
    phaseLabel: string;
    date: string;
    foremen: { id: string; displayName: string }[];
    selected: { foremanId: string; memberCount: number }[];
    existingAssignments: ProjectAssignment[];
    onChange: (v: { foremanId: string; memberCount: number }[]) => void;
}) {
    if (!date || foremen.length === 0) return null;

    const busyIds = new Set(existingAssignments.map(a => a.assignedEmployeeId));

    const toggle = (id: string, checked: boolean) => {
        if (checked) {
            onChange([...selected, { foremanId: id, memberCount: 1 }]);
        } else {
            onChange(selected.filter(s => s.foremanId !== id));
        }
    };

    const updateCount = (id: string, count: number) => {
        onChange(selected.map(s => s.foremanId === id ? { ...s, memberCount: Math.max(0, count) } : s));
    };

    return (
        <div className="mt-3">
            <p className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {phaseLabel ? `${phaseLabel}担当職長` : '担当職長'}
            </p>
            <div className="space-y-1.5">
                {foremen.map(f => {
                    const sel = selected.find(s => s.foremanId === f.id);
                    const isSelected = !!sel;
                    const isBusy = busyIds.has(f.id);
                    return (
                        <div
                            key={f.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${isSelected ? 'bg-slate-50 border border-slate-200' : 'hover:bg-slate-50'
                                }`}
                        >
                            <input
                                type="checkbox"
                                id={`foreman-${f.id}-${date}`}
                                checked={isSelected}
                                onChange={e => toggle(f.id, e.target.checked)}
                                className="w-4 h-4 rounded accent-slate-700 flex-shrink-0"
                            />
                            <label
                                htmlFor={`foreman-${f.id}-${date}`}
                                className="flex-1 flex items-center gap-1.5 text-sm cursor-pointer select-none"
                            >
                                <span className={isBusy ? 'text-amber-600 font-medium' : 'text-slate-700'}>
                                    {f.displayName}
                                </span>
                                {isBusy && (
                                    <span title="この日に別の案件あり">
                                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                                    </span>
                                )}
                            </label>
                            {isSelected && (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => updateCount(f.id, sel.memberCount - 1)}
                                        disabled={sel.memberCount <= 0}
                                        className="w-8 h-8 flex items-center justify-center border border-slate-300 rounded text-slate-600 disabled:opacity-30 active:bg-slate-100"
                                    >
                                        −
                                    </button>
                                    <span className="w-8 text-center text-sm font-medium">{sel.memberCount}</span>
                                    <button
                                        type="button"
                                        onClick={() => updateCount(f.id, sel.memberCount + 1)}
                                        className="w-8 h-8 flex items-center justify-center border border-slate-300 rounded text-slate-600 active:bg-slate-100"
                                    >
                                        ＋
                                    </button>
                                    <span className="text-xs text-slate-500">名</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function WorkDateRow({
    entry,
    constructionTypes,
    allForemen,
    displayedForemanIds,
    getTotalMembersForDate,
    getVacationEmployees,
    getForemanName,
    onChange,
    onDelete,
    canDelete,
}: {
    entry: WorkDateEntry;
    constructionTypes: ConstructionTypeMaster[];
    allForemen: { id: string; displayName: string }[];
    displayedForemanIds: string[];
    getTotalMembersForDate: (dateStr: string) => number;
    getVacationEmployees: (date: string) => string[];
    getForemanName: (id: string) => string;
    onChange: (updated: WorkDateEntry) => void;
    onDelete: () => void;
    canDelete: boolean;
}) {
    const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadAssignments = useCallback(async (date: string) => {
        if (!date) { setAssignments([]); return; }
        setIsLoading(true);
        try {
            const data = await fetchAssignmentsForDate(date);
            setAssignments(
                allForemen.length === 0
                    ? data
                    : data.filter(a => allForemen.some(f => f.id === a.assignedEmployeeId))
            );
        } finally {
            setIsLoading(false);
        }
    }, [allForemen]);

    useEffect(() => {
        loadAssignments(entry.date);
    }, [entry.date, loadAssignments]);

    const typeName = constructionTypes.find(t => t.id === entry.constructionType)?.name ?? '';

    return (
        <div className="p-3 border border-slate-200 rounded-lg space-y-2 bg-white">
            <div className="flex items-center gap-2">
                {/* 工事種別（先） */}
                <select
                    value={entry.constructionType}
                    onChange={e => onChange({ ...entry, constructionType: e.target.value })}
                    className="px-2 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-500 min-w-[100px]"
                >
                    <option value="">種別を選択</option>
                    {constructionTypes.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
                {/* 日付（後） */}
                <input
                    type="date"
                    value={entry.date}
                    onChange={e => onChange({ ...entry, date: e.target.value, foremen: [] })}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-slate-500"
                />
                {/* 削除ボタン */}
                {canDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        className="p-1.5 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                        title="この行を削除"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* 日付入力後に展開 */}
            {entry.date && (
                <>
                    <DateConflictList
                        assignments={assignments}
                        getForemanName={getForemanName}
                        displayedForemanIds={displayedForemanIds}
                        getTotalMembersForDate={getTotalMembersForDate}
                        dateStr={entry.date}
                        vacationCount={getVacationEmployees(entry.date).length}
                        isLoading={isLoading}
                    />
                    <ForemanSelector
                        phaseLabel={typeName}
                        date={entry.date}
                        foremen={allForemen}
                        selected={entry.foremen}
                        existingAssignments={assignments}
                        onChange={foremen => onChange({ ...entry, foremen })}
                    />
                </>
            )}
        </div>
    );
}

export function ConstructionSection({ formData, setFormData, projectMasterId }: ConstructionSectionProps) {
    const { data: session } = useSession();
    const role = session?.user?.role;
    const isAdminOrManager = role === 'admin' || role === 'manager';
    const { getForemanName, allForemen, displayedForemanIds } = useCalendarDisplay();
    const getVacationEmployees = useCalendarStore(state => state.getVacationEmployees);
    const getTotalMembersForDate = useMasterStore(state => state.getTotalMembersForDate);
    const constructionTypes = useMasterStore(selectConstructionTypes);

    // 見積から契約金額（足場工事金額）への反映（請求待ちと同じ方式：1件→自動／複数→選んで合計）
    const { estimates, ensureDataLoaded: ensureEstimatesLoaded } = useEstimates();
    useEffect(() => {
        if (projectMasterId) ensureEstimatesLoaded();
    }, [projectMasterId, ensureEstimatesLoaded]);
    const projectEstimates = useMemo(
        () => (projectMasterId ? estimates.filter((e) => e.projectId === projectMasterId) : []),
        [estimates, projectMasterId],
    );
    const [estimatePickerOpen, setEstimatePickerOpen] = useState(false);

    const applyContractFromEstimates = useCallback(
        (ests: { subtotal: number }[]) => {
            const sum = ests.reduce((s, e) => s + (e.subtotal || 0), 0);
            setFormData((prev) => ({ ...prev, contractAmount: String(Math.round(sum)) }));
            toast.success('見積金額を契約金額（足場工事金額）に反映しました');
        },
        [setFormData],
    );

    const handleReflectEstimate = useCallback(() => {
        if (projectEstimates.length === 0) {
            toast.error('この案件に見積書がありません');
            return;
        }
        const approved = projectEstimates.filter((e) => e.status === 'approved');
        if (projectEstimates.length === 1) {
            applyContractFromEstimates([projectEstimates[0]]);
            return;
        }
        if (approved.length === 1) {
            applyContractFromEstimates([approved[0]]);
            return;
        }
        setEstimatePickerOpen(true);
    }, [projectEstimates, applyContractFromEstimates]);

    const handleEstimatePickerConfirm = useCallback(
        (selectedIds: string[]) => {
            const chosen = projectEstimates.filter((e) => selectedIds.includes(e.id));
            if (chosen.length === 0) {
                toast.error('見積を選択してください');
                return;
            }
            applyContractFromEstimates(chosen);
            setEstimatePickerOpen(false);
        },
        [projectEstimates, applyContractFromEstimates],
    );

    // constructionTypes ロード後にデフォルト種別を自動セット（全行が未設定の場合のみ）
    useEffect(() => {
        if (constructionTypes.length === 0) return;
        setFormData(prev => {
            const allEmpty = prev.workDates.every(w => w.constructionType === '');
            if (!allEmpty) return prev;
            const assemblyId = constructionTypes.find(t => t.name === '組立')?.id ?? '';
            const demolitionId = constructionTypes.find(t => t.name === '解体')?.id ?? '';
            return {
                ...prev,
                workDates: prev.workDates.map((w, i) => ({
                    ...w,
                    constructionType: i === 0 ? assemblyId : i === 1 ? demolitionId : w.constructionType,
                })),
            };
        });
    }, [constructionTypes, setFormData]);

    const addWorkDate = () => {
        const newEntry: WorkDateEntry = {
            id: crypto.randomUUID(),
            constructionType: '',
            date: '',
            foremen: [],
        };
        setFormData(prev => ({ ...prev, workDates: [...prev.workDates, newEntry] }));
    };

    const updateWorkDate = (id: string, updated: WorkDateEntry) => {
        setFormData(prev => ({
            ...prev,
            workDates: prev.workDates.map(w => w.id === id ? updated : w),
        }));
    };

    const deleteWorkDate = (id: string) => {
        setFormData(prev => ({
            ...prev,
            workDates: prev.workDates.filter(w => w.id !== id),
        }));
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 面積 */}
                <FormField label="m2">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            step="0.1"
                            value={formData.area}
                            onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 150"
                        />
                    </div>
                </FormField>
                {/* 面積備考 */}
                <FormField label="備考">
                    <input
                        type="text"
                        value={formData.areaRemarks}
                        onChange={(e) => setFormData({ ...formData, areaRemarks: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                        placeholder="例: 外周のみ"
                    />
                </FormField>
            </div>

            {/* 作業日程 */}
            <div>
                <p className="text-sm font-medium text-slate-700 mb-2">作業日程</p>
                <div className="space-y-2">
                    {formData.workDates.map(entry => (
                        <WorkDateRow
                            key={entry.id}
                            entry={entry}
                            constructionTypes={constructionTypes}
                            allForemen={allForemen}
                            displayedForemanIds={displayedForemanIds}
                            getTotalMembersForDate={getTotalMembersForDate}
                            getVacationEmployees={getVacationEmployees}
                            getForemanName={getForemanName}
                            onChange={updated => updateWorkDate(entry.id, updated)}
                            onDelete={() => deleteWorkDate(entry.id)}
                            canDelete={formData.workDates.length > 1}
                        />
                    ))}
                </div>
                <button
                    type="button"
                    onClick={addWorkDate}
                    className="mt-2 flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    作業日を追加
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 予定組立人工 */}
                <FormField label="予定組立人工">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={formData.estimatedAssemblyWorkers}
                            onChange={(e) => setFormData({ ...formData, estimatedAssemblyWorkers: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 3"
                        />
                        <span className="text-sm text-slate-500">名</span>
                    </div>
                </FormField>
                {/* 予定解体人工 */}
                <FormField label="予定解体人工">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={formData.estimatedDemolitionWorkers}
                            onChange={(e) => setFormData({ ...formData, estimatedDemolitionWorkers: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 2"
                        />
                        <span className="text-sm text-slate-500">名</span>
                    </div>
                </FormField>
            </div>

            {/* 足場工事金額（管理者・マネージャーのみ） */}
            {isAdminOrManager && (
                <FormField label="足場工事金額">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min="0"
                            value={formData.contractAmount}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === '' || Number(val) >= 0) {
                                    setFormData({ ...formData, contractAmount: val });
                                }
                            }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 500000"
                        />
                        <span className="text-sm text-slate-500">円(税抜)</span>
                        {projectEstimates.length > 0 && (
                            <button
                                type="button"
                                onClick={handleReflectEstimate}
                                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                            >
                                <FileDown className="h-4 w-4" /> 見積から反映
                            </button>
                        )}
                    </div>
                    {projectEstimates.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500">
                            「見積から反映」で見積金額を契約金額に取り込めます（複数見積は選択して合計）。
                        </p>
                    )}
                </FormField>
            )}

            <EstimatePickerDialog
                open={estimatePickerOpen}
                projectTitle={formData.title || formData.name || ''}
                estimates={projectEstimates.map((e) => ({
                    id: e.id,
                    estimateNumber: e.estimateNumber,
                    title: e.title,
                    status: e.status,
                    subtotal: e.subtotal,
                }))}
                title="どの見積を契約金額に反映しますか？"
                confirmLabel="この見積で反映"
                onClose={() => setEstimatePickerOpen(false)}
                onConfirm={handleEstimatePickerConfirm}
            />
        </div>
    );
}
