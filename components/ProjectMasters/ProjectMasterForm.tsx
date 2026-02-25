'use client';

import React, { useState } from 'react';
import {
    ScaffoldingSpec,
    DEFAULT_SCAFFOLDING_SPEC,
    ConstructionContentType,
} from '@/types/calendar';
import { CollapsibleSection } from './common/CollapsibleSection';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { AddressSection } from './sections/AddressSection';
import { ConstructionSection } from './sections/ConstructionSection';
import { ScaffoldingSection } from './sections/ScaffoldingSection';
import { RemarksSection } from './sections/RemarksSection';
import { FilesSection } from './sections/FilesSection';

export interface WorkDateEntry {
    id: string;
    constructionType: string; // construction type UUID
    date: string;             // YYYY-MM-DD
    foremen: { foremanId: string; memberCount: number }[];
}

export interface ProjectMasterFormData {
    title: string;
    customerId: string;
    customerName: string;
    constructionContent: ConstructionContentType | '';
    // 住所情報
    postalCode: string;
    prefecture: string;
    city: string;
    location: string;
    plusCode: string;
    latitude?: number;
    longitude?: number;
    // 工事情報
    area: string;
    areaRemarks: string;
    workDates: WorkDateEntry[];
    estimatedAssemblyWorkers: string;
    estimatedDemolitionWorkers: string;
    contractAmount: string;
    // 足場仕様
    scaffoldingSpec: ScaffoldingSpec;
    // その他
    remarks: string;
    createdBy: string[];
}

export const DEFAULT_FORM_DATA: ProjectMasterFormData = {
    title: '',
    customerId: '',
    customerName: '',
    constructionContent: '',
    postalCode: '',
    prefecture: '',
    city: '',
    location: '',
    plusCode: '',
    latitude: undefined,
    longitude: undefined,
    area: '',
    areaRemarks: '',
    workDates: [
        { id: 'default-0', constructionType: '', date: '', foremen: [] },
        { id: 'default-1', constructionType: '', date: '', foremen: [] },
    ],
    estimatedAssemblyWorkers: '',
    estimatedDemolitionWorkers: '',
    contractAmount: '',
    scaffoldingSpec: DEFAULT_SCAFFOLDING_SPEC,
    remarks: '',
    createdBy: [],
};

interface ProjectMasterFormProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
    onSubmit: () => void;
    onCancel: () => void;
    isEdit?: boolean;
    projectMasterId?: string;
}

export function ProjectMasterForm({ formData, setFormData, onSubmit, onCancel, isEdit = false, projectMasterId }: ProjectMasterFormProps) {
    const [expandedSections, setExpandedSections] = useState({
        basic: true,
        address: true,
        construction: true,
        scaffolding: false,
        remarks: true,
        files: true,
    });

    const toggleSection = (section: keyof typeof expandedSections) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    return (
        <div className="space-y-4">
            {/* 基本情報セクション */}
            <CollapsibleSection
                title="基本情報"
                isExpanded={expandedSections.basic}
                onToggle={() => toggleSection('basic')}
            >
                <BasicInfoSection formData={formData} setFormData={setFormData} />
            </CollapsibleSection>

            {/* 住所セクション */}
            <CollapsibleSection
                title="住所情報"
                isExpanded={expandedSections.address}
                onToggle={() => toggleSection('address')}
            >
                <AddressSection formData={formData} setFormData={setFormData} />
            </CollapsibleSection>

            {/* 工事情報セクション */}
            <CollapsibleSection
                title="工事情報"
                isExpanded={expandedSections.construction}
                onToggle={() => toggleSection('construction')}
            >
                <ConstructionSection formData={formData} setFormData={setFormData} />
            </CollapsibleSection>

            {/* 足場仕様セクション */}
            <CollapsibleSection
                title="足場仕様"
                isExpanded={expandedSections.scaffolding}
                onToggle={() => toggleSection('scaffolding')}
            >
                <ScaffoldingSection formData={formData} setFormData={setFormData} />
            </CollapsibleSection>

            {/* 備考セクション */}
            <CollapsibleSection
                title="備考"
                isExpanded={expandedSections.remarks}
                onToggle={() => toggleSection('remarks')}
            >
                <RemarksSection formData={formData} setFormData={setFormData} />
            </CollapsibleSection>

            {/* ファイル添付セクション（編集モードのみ） */}
            {isEdit && projectMasterId && (
                <CollapsibleSection
                    title="ファイル・写真"
                    isExpanded={expandedSections.files}
                    onToggle={() => toggleSection('files')}
                >
                    <FilesSection projectMasterId={projectMasterId} />
                </CollapsibleSection>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                    キャンセル
                </button>
                <button
                    type="button"
                    onClick={onSubmit}
                    className="px-6 py-2 bg-slate-800 text-white font-semibold rounded-lg hover:bg-slate-700 transition-colors"
                >
                    {isEdit ? '更新' : '作成'}
                </button>
            </div>
        </div>
    );
}
