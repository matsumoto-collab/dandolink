'use client';

import React, { useEffect, useState } from 'react';
import { ProjectMasterFormData } from '../ProjectMasterForm';
import { X } from 'lucide-react';

interface ScheduleSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

interface ManagerOption {
    id: string;
    displayName: string;
}

export function ScheduleSection({ formData, setFormData }: ScheduleSectionProps) {
    const [managers, setManagers] = useState<ManagerOption[]>([]);

    useEffect(() => {
        fetch('/api/dispatch/foremen', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : [])
            .then((data: ManagerOption[]) => setManagers(data))
            .catch(() => {});
    }, []);

    const addManager = (id: string) => {
        if (!id || formData.managerIds.includes(id) || formData.managerIds.length >= 3) return;
        setFormData(prev => ({ ...prev, managerIds: [...prev.managerIds, id] }));
    };

    const removeManager = (id: string) => {
        setFormData(prev => ({ ...prev, managerIds: prev.managerIds.filter(m => m !== id) }));
    };

    const availableManagers = managers.filter(m => !formData.managerIds.includes(m.id));

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        工事開始予定日
                    </label>
                    <input
                        type="date"
                        value={formData.scheduledStartDate}
                        onChange={(e) => setFormData(prev => ({ ...prev, scheduledStartDate: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        工事完了予定日
                    </label>
                    <input
                        type="date"
                        value={formData.scheduledEndDate}
                        onChange={(e) => setFormData(prev => ({ ...prev, scheduledEndDate: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
                    />
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    担当者（最大3名）
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                    {formData.managerIds.map(id => {
                        const mgr = managers.find(m => m.id === id);
                        return (
                            <span
                                key={id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 text-teal-700 rounded-lg text-sm border border-teal-200"
                            >
                                {mgr?.displayName ?? id.slice(0, 8)}
                                <button
                                    type="button"
                                    onClick={() => removeManager(id)}
                                    className="hover:text-red-500 transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </span>
                        );
                    })}
                </div>
                {formData.managerIds.length < 3 && (
                    <select
                        value=""
                        onChange={(e) => addManager(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm text-sm"
                    >
                        <option value="">担当者を追加...</option>
                        {availableManagers.map(m => (
                            <option key={m.id} value={m.id}>{m.displayName}</option>
                        ))}
                    </select>
                )}
            </div>
        </div>
    );
}
