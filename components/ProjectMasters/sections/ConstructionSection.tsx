'use client';

import React from 'react';
import { FormField } from '../common/FormField';
import { ProjectMasterFormData } from '../ProjectMasterForm';

interface ConstructionSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

export function ConstructionSection({ formData, setFormData }: ConstructionSectionProps) {
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
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            placeholder="m2"
                        />
                    </div>
                </FormField>
                {/* 面積備考 */}
                <FormField label="備考">
                    <input
                        type="text"
                        value={formData.areaRemarks}
                        onChange={(e) => setFormData({ ...formData, areaRemarks: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="備考"
                    />
                </FormField>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 組立日 */}
                <FormField label="組立日">
                    <input
                        type="date"
                        value={formData.assemblyDate}
                        onChange={(e) => setFormData({ ...formData, assemblyDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                </FormField>
                {/* 解体日 */}
                <FormField label="解体日">
                    <input
                        type="date"
                        value={formData.demolitionDate}
                        onChange={(e) => setFormData({ ...formData, demolitionDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            placeholder="予定組立人工"
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
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            placeholder="予定解体人工"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="請負金額"
                    />
                    <span className="text-sm text-gray-500">円(税抜)</span>
                </div>
            </FormField>
        </div>
    );
}
