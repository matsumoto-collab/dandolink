'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { FormField } from '../common/FormField';
import { ProjectMasterFormData } from '../ProjectMasterForm';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { ProjectAssignment } from '@/types/calendar';

interface ConstructionSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

/** 指定日の案件一覧を取得する */
async function fetchAssignmentsForDate(date: string): Promise<ProjectAssignment[]> {
    const res = await fetch(
        `/api/assignments?startDate=${date}&endDate=${date}`,
        { cache: 'no-store' }
    );
    if (!res.ok) return [];
    return res.json();
}

/** 日付に紐づく既存案件の表示リスト */
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

export function ConstructionSection({ formData, setFormData }: ConstructionSectionProps) {
    const { getForemanName } = useCalendarDisplay();

    const [assemblyAssignments, setAssemblyAssignments] = useState<ProjectAssignment[]>([]);
    const [demolitionAssignments, setDemolitionAssignments] = useState<ProjectAssignment[]>([]);
    const [isLoadingAssembly, setIsLoadingAssembly] = useState(false);
    const [isLoadingDemolition, setIsLoadingDemolition] = useState(false);

    const loadAssemblyAssignments = useCallback(async (date: string) => {
        if (!date) { setAssemblyAssignments([]); return; }
        setIsLoadingAssembly(true);
        try {
            const data = await fetchAssignmentsForDate(date);
            setAssemblyAssignments(data);
        } finally {
            setIsLoadingAssembly(false);
        }
    }, []);

    const loadDemolitionAssignments = useCallback(async (date: string) => {
        if (!date) { setDemolitionAssignments([]); return; }
        setIsLoadingDemolition(true);
        try {
            const data = await fetchAssignmentsForDate(date);
            setDemolitionAssignments(data);
        } finally {
            setIsLoadingDemolition(false);
        }
    }, []);

    // 初期値があればロード（編集時）
    useEffect(() => {
        if (formData.assemblyDate) loadAssemblyAssignments(formData.assemblyDate);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (formData.demolitionDate) loadDemolitionAssignments(formData.demolitionDate);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
                            setFormData({ ...formData, assemblyDate: val });
                            loadAssemblyAssignments(val);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    />
                    <DateConflictList
                        assignments={assemblyAssignments}
                        getForemanName={getForemanName}
                        isLoading={isLoadingAssembly}
                    />
                </FormField>

                {/* 解体日 */}
                <FormField label="解体日">
                    <input
                        type="date"
                        value={formData.demolitionDate}
                        onChange={(e) => {
                            const val = e.target.value;
                            setFormData({ ...formData, demolitionDate: val });
                            loadDemolitionAssignments(val);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    />
                    <DateConflictList
                        assignments={demolitionAssignments}
                        getForemanName={getForemanName}
                        isLoading={isLoadingDemolition}
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
