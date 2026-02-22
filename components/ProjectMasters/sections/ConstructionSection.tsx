'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Users } from 'lucide-react';
import { FormField } from '../common/FormField';
import { ProjectMasterFormData } from '../ProjectMasterForm';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { ProjectAssignment } from '@/types/calendar';

interface ConstructionSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

/**
 * 指定日の案件一覧を取得する。
 * endDate に翌日を渡すことで lte の厳密一致問題を回避し、client 側でフィルタする。
 */
async function fetchAssignmentsForDate(date: string): Promise<ProjectAssignment[]> {
    const nextDay = new Date(`${date}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextDayStr = nextDay.toISOString().split('T')[0];

    const res = await fetch(
        `/api/assignments?startDate=${date}&endDate=${nextDayStr}`,
        { cache: 'no-store' }
    );
    if (!res.ok) return [];
    const all: ProjectAssignment[] = await res.json();
    // 当日分のみ（日付文字列の先頭10文字で比較）
    return all.filter(a => new Date(a.date).toISOString().slice(0, 10) === date);
}

/** 日付に紐づく既存案件リスト */
function DateConflictList({
    assignments,
    getForemanName,
    isLoading,
}: {
    assignments: ProjectAssignment[];
    getForemanName: (id: string) => string;
    isLoading: boolean;
}) {
    if (isLoading) {
        return (
            <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                この日の案件を確認中...
            </div>
        );
    }
    if (assignments.length === 0) return null;

    return (
        <div className="mt-2 space-y-1">
            <p className="text-xs font-medium text-amber-600">
                この日に既に入っている案件（{assignments.length}件）
            </p>
            {assignments.map(a => (
                <div
                    key={a.id}
                    className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs"
                >
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    <span className="font-semibold text-gray-800 min-w-[4rem]">
                        {getForemanName(a.assignedEmployeeId)}
                    </span>
                    <span className="text-gray-600 truncate">
                        {a.projectMaster?.title ?? '（現場名なし）'}
                    </span>
                    {a.memberCount > 0 && (
                        <span className="ml-auto text-gray-500 whitespace-nowrap flex-shrink-0">
                            {a.memberCount}名
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}

/** 職長選択 + 人数入力 */
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
        onChange(selected.map(s => s.foremanId === id ? { ...s, memberCount: Math.max(1, count) } : s));
    };

    return (
        <div className="mt-3">
            <p className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {phaseLabel}担当職長
            </p>
            <div className="space-y-1.5">
                {foremen.map(f => {
                    const sel = selected.find(s => s.foremanId === f.id);
                    const isSelected = !!sel;
                    const isBusy = busyIds.has(f.id);
                    return (
                        <div
                            key={f.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                                isSelected
                                    ? 'bg-slate-50 border border-slate-200'
                                    : 'hover:bg-gray-50'
                            }`}
                        >
                            <input
                                type="checkbox"
                                id={`${phaseLabel}-${f.id}`}
                                checked={isSelected}
                                onChange={e => toggle(f.id, e.target.checked)}
                                className="w-4 h-4 rounded accent-slate-700 flex-shrink-0"
                            />
                            <label
                                htmlFor={`${phaseLabel}-${f.id}`}
                                className="flex-1 flex items-center gap-1.5 text-sm cursor-pointer select-none"
                            >
                                <span className={isBusy ? 'text-amber-600 font-medium' : 'text-gray-700'}>
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
                                    <input
                                        type="number"
                                        min={1}
                                        value={sel.memberCount}
                                        onChange={e => updateCount(f.id, parseInt(e.target.value) || 1)}
                                        className="w-14 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-slate-500 text-center"
                                    />
                                    <span className="text-xs text-gray-500">名</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function ConstructionSection({ formData, setFormData }: ConstructionSectionProps) {
    const { getForemanName, allForemen } = useCalendarDisplay();

    const [assemblyAssignments, setAssemblyAssignments] = useState<ProjectAssignment[]>([]);
    const [demolitionAssignments, setDemolitionAssignments] = useState<ProjectAssignment[]>([]);
    const [isLoadingAssembly, setIsLoadingAssembly] = useState(false);
    const [isLoadingDemolition, setIsLoadingDemolition] = useState(false);

    const loadAssemblyAssignments = useCallback(async (date: string) => {
        if (!date) { setAssemblyAssignments([]); return; }
        setIsLoadingAssembly(true);
        try {
            const data = await fetchAssignmentsForDate(date);
            // allForemen 未ロード時は全件表示、ロード後は登録済み職長のみ
            setAssemblyAssignments(
                allForemen.length === 0
                    ? data
                    : data.filter(a => allForemen.some(f => f.id === a.assignedEmployeeId))
            );
        } finally {
            setIsLoadingAssembly(false);
        }
    }, [allForemen]);

    const loadDemolitionAssignments = useCallback(async (date: string) => {
        if (!date) { setDemolitionAssignments([]); return; }
        setIsLoadingDemolition(true);
        try {
            const data = await fetchAssignmentsForDate(date);
            setDemolitionAssignments(
                allForemen.length === 0
                    ? data
                    : data.filter(a => allForemen.some(f => f.id === a.assignedEmployeeId))
            );
        } finally {
            setIsLoadingDemolition(false);
        }
    }, [allForemen]);

    // 日付または allForemen 変化で再取得・再フィルタ
    useEffect(() => {
        if (formData.assemblyDate) loadAssemblyAssignments(formData.assemblyDate);
    }, [formData.assemblyDate, loadAssemblyAssignments]);

    useEffect(() => {
        if (formData.demolitionDate) loadDemolitionAssignments(formData.demolitionDate);
    }, [formData.demolitionDate, loadDemolitionAssignments]);

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
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                        placeholder="例: 外周のみ"
                    />
                </FormField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 組立日 */}
                <FormField label="組立日">
                    <input
                        type="date"
                        value={formData.assemblyDate}
                        onChange={(e) => {
                            const val = e.target.value;
                            // 日付が変わったら職長選択をリセット
                            setFormData(prev => ({ ...prev, assemblyDate: val, assemblyForemen: [] }));
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    />
                    <DateConflictList
                        assignments={assemblyAssignments}
                        getForemanName={getForemanName}
                        isLoading={isLoadingAssembly}
                    />
                    <ForemanSelector
                        phaseLabel="組立"
                        date={formData.assemblyDate}
                        foremen={allForemen}
                        selected={formData.assemblyForemen}
                        existingAssignments={assemblyAssignments}
                        onChange={v => setFormData(prev => ({ ...prev, assemblyForemen: v }))}
                    />
                </FormField>

                {/* 解体日 */}
                <FormField label="解体日">
                    <input
                        type="date"
                        value={formData.demolitionDate}
                        onChange={(e) => {
                            const val = e.target.value;
                            setFormData(prev => ({ ...prev, demolitionDate: val, demolitionForemen: [] }));
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    />
                    <DateConflictList
                        assignments={demolitionAssignments}
                        getForemanName={getForemanName}
                        isLoading={isLoadingDemolition}
                    />
                    <ForemanSelector
                        phaseLabel="解体"
                        date={formData.demolitionDate}
                        foremen={allForemen}
                        selected={formData.demolitionForemen}
                        existingAssignments={demolitionAssignments}
                        onChange={v => setFormData(prev => ({ ...prev, demolitionForemen: v }))}
                    />
                </FormField>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 予定組立人工 */}
                <FormField label="予定組立人工">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={formData.estimatedAssemblyWorkers}
                            onChange={(e) => setFormData({ ...formData, estimatedAssemblyWorkers: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 3"
                        />
                        <span className="text-sm text-gray-500">名</span>
                    </div>
                </FormField>
                {/* 予定解体人工 */}
                <FormField label="予定解体人工">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={formData.estimatedDemolitionWorkers}
                            onChange={(e) => setFormData({ ...formData, estimatedDemolitionWorkers: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 2"
                        />
                        <span className="text-sm text-gray-500">名</span>
                    </div>
                </FormField>
            </div>

            {/* 請負金額 */}
            <FormField label="請負金額">
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        value={formData.contractAmount}
                        onChange={(e) => setFormData({ ...formData, contractAmount: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                        placeholder="例: 500000"
                    />
                    <span className="text-sm text-gray-500">円(税抜)</span>
                </div>
            </FormField>
        </div>
    );
}
