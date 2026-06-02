'use client';

import React, { useState } from 'react';
import {
    ScaffoldingSpec,
    DEFAULT_SCAFFOLDING_SPEC,
} from '@/types/calendar';
import { CollapsibleSection } from './common/CollapsibleSection';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { AddressSection } from './sections/AddressSection';
import { ConstructionSection } from './sections/ConstructionSection';
import { SubcontractorCostSection } from './sections/SubcontractorCostSection';
import { ScaffoldingSection } from './sections/ScaffoldingSection';
import { RemarksSection } from './sections/RemarksSection';
import { FilesSection } from './sections/FilesSection';

export interface WorkDateEntry {
    id: string;
    constructionType: string; // construction type UUID
    date: string;             // YYYY-MM-DD
    foremen: { foremanId: string; memberCount: number }[];
}

export interface SubcontractorCostEntry {
    id: string;               // row key (UUID)
    constructionTypeId: string;
    amount: string;           // 作業費。入力中の文字列。保存時にnumberへ
    transportCost: string;    // 運搬費。空文字なら未設定（null として送信）
}

export interface ProjectMasterFormData {
    title: string;
    name: string;
    honorific: string;
    constructionSuffixId: string;
    siteShortName: string;
    customerId: string;
    customerName: string;
    constructionContent: string;
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
    // 協力業者費（工事種別ごとの設定額。手配確定 & 職長がパートナーの場合に計上）
    subcontractorCosts: SubcontractorCostEntry[];
    // 足場仕様
    scaffoldingSpec: ScaffoldingSpec;
    // その他
    remarks: string;
    createdBy: string[];
}

export const DEFAULT_FORM_DATA: ProjectMasterFormData = {
    title: '',
    name: '',
    honorific: '様邸',
    constructionSuffixId: '',
    siteShortName: '',
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
    subcontractorCosts: [],
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
    errors?: Record<string, string>;
}

export function ProjectMasterForm({ formData, setFormData, onSubmit, onCancel, isEdit = false, projectMasterId, errors }: ProjectMasterFormProps) {
    const [expandedSections, setExpandedSections] = useState({
        basic: true,
        address: true,
        construction: true,
        subcontractor: false,
        scaffolding: false,
        remarks: true,
        files: true,
    });

    // エラーが入っている間は基本情報セクションを必ず展開（スクロール先が閉じていると見えないため）
    const hasBasicError = !!(errors && (errors.name || errors.constructionContent || errors.createdBy || errors.customerName));
    React.useEffect(() => {
        if (hasBasicError) {
            setExpandedSections(prev => (prev.basic ? prev : { ...prev, basic: true }));
        }
    }, [hasBasicError]);

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
                <BasicInfoSection formData={formData} setFormData={setFormData} errors={errors} />
            </CollapsibleSection>

            {/* 住所セクション */}
            <CollapsibleSection
                title="住所情報"
                isExpanded={expandedSections.address}
                onToggle={() => toggleSection('address')}
            >
                <AddressSection key={projectMasterId ?? 'new'} formData={formData} setFormData={setFormData} />
            </CollapsibleSection>

            {/* 工事情報セクション */}
            <CollapsibleSection
                title="工事情報"
                isExpanded={expandedSections.construction}
                onToggle={() => toggleSection('construction')}
            >
                <ConstructionSection formData={formData} setFormData={setFormData} projectMasterId={projectMasterId} />
            </CollapsibleSection>

            {/* 協力業者費セクション */}
            <CollapsibleSection
                title="協力業者費（予定）"
                isExpanded={expandedSections.subcontractor}
                onToggle={() => toggleSection('subcontractor')}
            >
                <SubcontractorCostSection
                    formData={formData}
                    setFormData={setFormData}
                    projectMasterId={projectMasterId}
                />
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

            {/* ファイル添付セクション */}
            <CollapsibleSection
                title="ファイル・写真"
                isExpanded={expandedSections.files}
                onToggle={() => toggleSection('files')}
            >
                {isEdit && projectMasterId ? (
                    <FilesSection projectMasterId={projectMasterId} />
                ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                        <p className="text-sm text-slate-500">
                            ファイル・写真は案件を登録した後にアップロードできます。
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                            先に案件を「作成」してから、編集画面でアップロードしてください。
                        </p>
                    </div>
                )}
            </CollapsibleSection>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                    キャンセル
                </button>
                <button
                    type="button"
                    onClick={onSubmit}
                    className="px-6 py-2 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 transition-colors"
                >
                    {isEdit ? '更新' : '作成'}
                </button>
            </div>
        </div>
    );
}
